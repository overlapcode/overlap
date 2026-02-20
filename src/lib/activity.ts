/**
 * Activity Block Classification
 *
 * Groups session events into goal-level activity blocks using LLM classification.
 * Skipped entirely when llm_provider is 'heuristic' or not configured.
 *
 * Flow:
 *   1. On each prompt, check if it belongs to the current activity block
 *   2. If no block exists, create one seeded from the prompt
 *   3. If the prompt is unrelated, close the current block and start a new one
 *   4. Periodically refine block name/description as more context arrives
 */

import type { D1Database } from '@cloudflare/workers-types';
import { getTeamConfig } from '@lib/db/queries';
import { decrypt } from '@lib/utils/crypto';
import type { ActivityBlock } from '@lib/db/types';

// ── LLM Prompt Templates ────────────────────────────────────────────────

const CLASSIFY_PROMPT = `You are classifying activity within a coding agent session. You will be given:
- The current activity block's name and description (if one exists)
- Recent prompts in the current block
- A new user prompt

Determine if the new prompt is part of the same activity or starts a new one.

Current activity: {current_activity}
Recent prompts in current block:
{recent_prompts}

New prompt:
"{new_prompt}"

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "related": true/false,
  "name": "short activity name (3-8 words)",
  "description": "one sentence describing the goal",
  "task_type": "feature|bugfix|refactor|debug|test|docs|config|exploration|review|migration|deploy"
}

If related=true, the name/description/task_type should describe the OVERALL activity (possibly refined with new context).
If related=false, the name/description/task_type should describe the NEW activity starting with this prompt.`;

const SEED_PROMPT = `You are classifying the first prompt in a new coding agent session activity.

User prompt:
"{prompt}"

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "name": "short activity name (3-8 words)",
  "description": "one sentence describing the goal",
  "task_type": "feature|bugfix|refactor|debug|test|docs|config|exploration|review|migration|deploy"
}`;

// ── Types ────────────────────────────────────────────────────────────────

type ClassificationResult = {
  related: boolean;
  name: string;
  description: string;
  task_type: string;
};

type SeedResult = {
  name: string;
  description: string;
  task_type: string;
};

type LLMProvider = {
  call(prompt: string, apiKey: string, model?: string): Promise<string>;
};

// ── LLM Providers ────────────────────────────────────────────────────────

const anthropicProvider: LLMProvider = {
  async call(prompt, apiKey, model) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status}`);
    const data = (await resp.json()) as { content: Array<{ type: string; text?: string }> };
    return data.content.find((c) => c.type === 'text')?.text?.trim() || '{}';
  },
};

const openaiCompatibleProvider = (baseUrl: string, name: string, defaultModel: string): LLMProvider => ({
  async call(prompt, apiKey, model) {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || defaultModel,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`${name} API error: ${resp.status}`);
    const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() || '{}';
  },
});

const googleProvider: LLMProvider = {
  async call(prompt, apiKey, model) {
    const modelName = model || 'gemini-2.5-flash-lite';
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 200 },
        }),
      }
    );
    if (!resp.ok) throw new Error(`Google API error: ${resp.status}`);
    const data = (await resp.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    return data.candidates[0]?.content?.parts[0]?.text?.trim() || '{}';
  },
};

const llmProviders: Record<string, LLMProvider> = {
  anthropic: anthropicProvider,
  openai: openaiCompatibleProvider('https://api.openai.com/v1', 'OpenAI', 'gpt-5-nano'),
  xai: openaiCompatibleProvider('https://api.x.ai/v1', 'xAI', 'grok-4-fast-non-reasoning'),
  google: googleProvider,
};

// ── Helpers ──────────────────────────────────────────────────────────────

function parseJSON<T>(raw: string): T | null {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

async function getLatestBlock(db: D1Database, sessionId: string): Promise<ActivityBlock | null> {
  const result = await db
    .prepare(`SELECT * FROM activity_blocks WHERE session_id = ? ORDER BY block_index DESC LIMIT 1`)
    .bind(sessionId)
    .first<ActivityBlock>();
  return result ?? null;
}

async function getRecentPromptsInBlock(
  db: D1Database,
  sessionId: string,
  startedAt: string,
  endedAt: string | null,
): Promise<string[]> {
  const query = endedAt
    ? `SELECT prompt_text FROM prompts WHERE session_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 5`
    : `SELECT prompt_text FROM prompts WHERE session_id = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT 5`;

  const bindings = endedAt ? [sessionId, startedAt, endedAt] : [sessionId, startedAt];
  const result = await db.prepare(query).bind(...bindings).all<{ prompt_text: string | null }>();
  return result.results.map((r) => r.prompt_text).filter((t): t is string => t != null);
}

// ── Core Logic ───────────────────────────────────────────────────────────

/**
 * Classify a new prompt and assign it to an activity block.
 * Called from ingest pipeline via waitUntil for each prompt event.
 */
export async function classifyActivity(
  db: D1Database,
  sessionId: string,
  userId: string,
  repoName: string,
  promptText: string,
  promptTimestamp: string,
  encryptionKey?: string,
): Promise<void> {
  try {
    const teamConfig = await getTeamConfig(db);
    if (!teamConfig) return;

    // Skip if no LLM provider or set to heuristic
    if (!teamConfig.llm_provider || teamConfig.llm_provider === 'heuristic' || !teamConfig.llm_api_key_encrypted) {
      return;
    }

    const provider = llmProviders[teamConfig.llm_provider];
    if (!provider) return;

    if (!encryptionKey) return;
    const apiKey = await decrypt(teamConfig.llm_api_key_encrypted, encryptionKey);

    const currentBlock = await getLatestBlock(db, sessionId);

    if (!currentBlock) {
      // First prompt in session — seed a new block
      const prompt = SEED_PROMPT.replace('{prompt}', promptText.slice(0, 500));
      const raw = await provider.call(prompt, apiKey, teamConfig.llm_model ?? undefined);
      const result = parseJSON<SeedResult>(raw);

      await db
        .prepare(
          `INSERT INTO activity_blocks (session_id, user_id, repo_name, block_index, started_at, ended_at, name, description, task_type, confidence)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          sessionId,
          userId,
          repoName,
          promptTimestamp,
          promptTimestamp,
          result?.name ?? promptText.slice(0, 100),
          result?.description ?? null,
          result?.task_type ?? null,
          result ? 0.8 : 0.3,
        )
        .run();
      return;
    }

    // Existing block — check if this prompt is related
    const recentPrompts = await getRecentPromptsInBlock(db, sessionId, currentBlock.started_at, null);
    const recentList = recentPrompts
      .slice(0, 5)
      .map((p, i) => `${i + 1}. "${p.slice(0, 200)}"`)
      .join('\n');

    const currentActivity = currentBlock.name
      ? `"${currentBlock.name}" — ${currentBlock.description || 'no description'}`
      : 'No activity classified yet';

    const prompt = CLASSIFY_PROMPT
      .replace('{current_activity}', currentActivity)
      .replace('{recent_prompts}', recentList || 'None yet')
      .replace('{new_prompt}', promptText.slice(0, 500));

    const raw = await provider.call(prompt, apiKey, teamConfig.llm_model ?? undefined);
    const result = parseJSON<ClassificationResult>(raw);

    if (!result) {
      // Parse failed — extend current block silently
      await db
        .prepare(`UPDATE activity_blocks SET ended_at = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(promptTimestamp, currentBlock.id)
        .run();
      return;
    }

    if (result.related) {
      // Same activity — extend and possibly refine
      await db
        .prepare(
          `UPDATE activity_blocks SET ended_at = ?, name = ?, description = ?, task_type = ?, confidence = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .bind(
          promptTimestamp,
          result.name || currentBlock.name,
          result.description || currentBlock.description,
          result.task_type || currentBlock.task_type,
          result.name ? 0.9 : (currentBlock.confidence ?? 0.8),
          currentBlock.id,
        )
        .run();
    } else {
      // New activity — close current block, create new one
      await db.batch([
        db
          .prepare(`UPDATE activity_blocks SET updated_at = datetime('now') WHERE id = ?`)
          .bind(currentBlock.id),
        db
          .prepare(
            `INSERT INTO activity_blocks (session_id, user_id, repo_name, block_index, started_at, ended_at, name, description, task_type, confidence)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            sessionId,
            userId,
            repoName,
            currentBlock.block_index + 1,
            promptTimestamp,
            promptTimestamp,
            result.name,
            result.description,
            result.task_type,
            0.8,
          ),
      ]);
    }
  } catch (error) {
    // Activity classification failure should never break ingest
    console.error('Error classifying activity:', error);
  }
}
