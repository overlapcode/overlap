/**
 * Rolling LLM Summary Generation
 *
 * Generates summaries for coding agent sessions using the team's configured LLM provider.
 * Triggered every 3 events (prompts or file_ops) or when a session ends.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { getTeamConfig, getSessionPrompts, updateSessionSummary, getSessionById } from '@lib/db/queries';
// Types used internally - TeamConfig from queries, FileOperation not needed as we query directly
import { decrypt } from '@lib/utils/crypto';

const SUMMARY_THRESHOLD = 3; // Generate summary after this many events

// Prompt for summary generation
const SUMMARY_PROMPT = `Summarize this Claude Code session in 1-2 sentences.
Focus on WHAT is being done, not HOW.

Prompts:
{prompts}

Files touched:
{files}

Respond with ONLY the summary text, no quotes or explanation.`;

type SummaryProvider = {
  name: string;
  generateSummary(prompts: string[], files: string[], apiKey: string, model?: string): Promise<string>;
};

// Anthropic provider for summaries
const anthropicSummaryProvider: SummaryProvider = {
  name: 'anthropic',

  async generateSummary(prompts: string[], files: string[], apiKey: string, model?: string): Promise<string> {
    const prompt = buildSummaryPrompt(prompts, files);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-3-5-haiku-latest',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    const textContent = data.content.find((c) => c.type === 'text');
    return textContent?.text?.trim() || 'Working on code';
  },
};

// OpenAI provider for summaries
const openaiSummaryProvider: SummaryProvider = {
  name: 'openai',

  async generateSummary(prompts: string[], files: string[], apiKey: string, model?: string): Promise<string> {
    const prompt = buildSummaryPrompt(prompts, files);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0]?.message?.content?.trim() || 'Working on code';
  },
};

// xAI provider for summaries
const xaiSummaryProvider: SummaryProvider = {
  name: 'xai',

  async generateSummary(prompts: string[], files: string[], apiKey: string, model?: string): Promise<string> {
    const prompt = buildSummaryPrompt(prompts, files);

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'grok-2-latest',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`xAI API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0]?.message?.content?.trim() || 'Working on code';
  },
};

// Google provider for summaries
const googleSummaryProvider: SummaryProvider = {
  name: 'google',

  async generateSummary(prompts: string[], files: string[], apiKey: string, model?: string): Promise<string> {
    const prompt = buildSummaryPrompt(prompts, files);
    const modelName = model || 'gemini-1.5-flash';

    const response = await fetch(
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

    if (!response.ok) {
      throw new Error(`Google API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };

    return data.candidates[0]?.content?.parts[0]?.text?.trim() || 'Working on code';
  },
};

const providers: Record<string, SummaryProvider> = {
  anthropic: anthropicSummaryProvider,
  openai: openaiSummaryProvider,
  xai: xaiSummaryProvider,
  google: googleSummaryProvider,
};

function buildSummaryPrompt(prompts: string[], files: string[]): string {
  const promptList = prompts
    .slice(0, 10)
    .map((p, i) => `${i + 1}. "${p.slice(0, 200)}"`)
    .join('\n');

  const fileList = files
    .slice(0, 20)
    .map((f) => `- ${f}`)
    .join('\n');

  return SUMMARY_PROMPT.replace('{prompts}', promptList || 'No prompts recorded').replace(
    '{files}',
    fileList || 'No files touched'
  );
}

/**
 * Check if a session should have its summary regenerated.
 * Returns true if summary_event_count >= SUMMARY_THRESHOLD.
 */
export async function shouldGenerateSummary(db: D1Database, sessionId: string): Promise<boolean> {
  const session = await getSessionById(db, sessionId);
  if (!session) return false;
  return session.summary_event_count >= SUMMARY_THRESHOLD;
}

/**
 * Generate and store a rolling summary for a session.
 * Uses the team's configured LLM provider.
 * Falls back to first prompt if no LLM configured.
 */
export async function generateSessionSummary(
  db: D1Database,
  sessionId: string,
  encryptionKey?: string
): Promise<void> {
  try {
    // Get team config
    const teamConfig = await getTeamConfig(db);
    if (!teamConfig) {
      console.error('No team config found, cannot generate summary');
      return;
    }

    // Get session prompts
    const prompts = await getSessionPrompts(db, sessionId);

    // Get file operations for this session
    const fileOpsResult = await db
      .prepare(
        `SELECT DISTINCT file_path, tool_name FROM file_operations
         WHERE session_id = ? ORDER BY timestamp`
      )
      .bind(sessionId)
      .all<{ file_path: string; tool_name: string }>();

    const files = fileOpsResult.results.map((fo) => `${fo.file_path} (${fo.tool_name})`);
    const promptTexts = prompts.map((p) => p.prompt_text);

    // If no LLM configured, use first prompt as summary
    if (!teamConfig.llm_provider || !teamConfig.llm_api_key_encrypted) {
      const fallbackSummary = promptTexts[0]?.slice(0, 200) || 'Working on code';
      await updateSessionSummary(db, sessionId, fallbackSummary);
      return;
    }

    // Need encryption key to decrypt API key
    if (!encryptionKey) {
      console.warn('No encryption key available, using fallback summary');
      const fallbackSummary = promptTexts[0]?.slice(0, 200) || 'Working on code';
      await updateSessionSummary(db, sessionId, fallbackSummary);
      return;
    }

    // Get provider
    const provider = providers[teamConfig.llm_provider];
    if (!provider) {
      console.warn(`Unknown LLM provider: ${teamConfig.llm_provider}, using fallback`);
      const fallbackSummary = promptTexts[0]?.slice(0, 200) || 'Working on code';
      await updateSessionSummary(db, sessionId, fallbackSummary);
      return;
    }

    // Decrypt API key
    const apiKey = await decrypt(teamConfig.llm_api_key_encrypted, encryptionKey);

    // Generate summary
    const summary = await provider.generateSummary(
      promptTexts,
      files,
      apiKey,
      teamConfig.llm_model ?? undefined
    );

    // Store summary
    await updateSessionSummary(db, sessionId, summary);
  } catch (error) {
    console.error('Error generating session summary:', error);
    // Don't throw - summary generation failure shouldn't break ingest
  }
}

/**
 * Check and generate summary if needed.
 * Called after processing events in ingest.
 * Uses ctx.waitUntil() to not block the response.
 */
export async function maybeGenerateSummary(
  db: D1Database,
  sessionId: string,
  encryptionKey?: string
): Promise<void> {
  const shouldGenerate = await shouldGenerateSummary(db, sessionId);
  if (shouldGenerate) {
    await generateSessionSummary(db, sessionId, encryptionKey);
  }
}
