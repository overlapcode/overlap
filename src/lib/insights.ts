/**
 * Two-Layer Insights Generation
 *
 * Layer 1: Per-session facet generation — each session is analyzed individually
 *          by LLM to extract goals, outcomes, friction, session type, etc.
 *
 * Layer 2: Period insight synthesis — aggregates all facets + stats for a period,
 *          then synthesizes a rich narrative report with project areas, behavioral
 *          analysis, friction patterns, accomplishments, and recommendations.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type {
  InsightContent,
  InsightPeriodType,
  InsightScope,
  TeamConfig,
  Session,
  SessionFacet,
  ParsedGoalCategories,
  ParsedFrictionCounts,
} from '@lib/db/types';
import {
  getSessionsWithoutFacets,
} from '@lib/db/queries';
import { decrypt } from '@lib/utils/crypto';

// ── Period Helpers ──────────────────────────────────────────────────────

export type PeriodInfo = {
  type: InsightPeriodType;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  label: string;
};

/** Get all completed periods of a given type up to now. */
export function getAvailablePeriods(type: InsightPeriodType, earliestDate: string): PeriodInfo[] {
  const periods: PeriodInfo[] = [];
  const now = new Date();
  const earliest = new Date(earliestDate + 'T00:00:00Z');

  if (type === 'week') {
    const d = new Date(earliest);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    d.setUTCHours(0, 0, 0, 0);
    while (d < now) {
      const start = d.toISOString().split('T')[0];
      const end = new Date(d);
      end.setUTCDate(end.getUTCDate() + 6);
      if (end < now) {
        const startMonth = d.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
        const endMonth = end.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
        const startDay = d.getUTCDate();
        const endDay = end.getUTCDate();
        const label = startMonth === endMonth
          ? `${startMonth} ${startDay} - ${endDay}`
          : `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
        periods.push({ type: 'week', start, end: end.toISOString().split('T')[0], label });
      }
      d.setUTCDate(d.getUTCDate() + 7);
    }
  } else if (type === 'month') {
    const d = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1));
    while (d < now) {
      const start = d.toISOString().split('T')[0];
      const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      if (nextMonth < now) {
        periods.push({ type: 'month', start, end: nextMonth.toISOString().split('T')[0], label: `${d.toLocaleString('en', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}` });
      }
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  } else if (type === 'quarter') {
    const startQ = Math.floor(earliest.getUTCMonth() / 3);
    const d = new Date(Date.UTC(earliest.getUTCFullYear(), startQ * 3, 1));
    while (d < now) {
      const qStart = d.toISOString().split('T')[0];
      const qEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 0));
      if (qEnd < now) {
        const q = Math.floor(d.getUTCMonth() / 3) + 1;
        periods.push({ type: 'quarter', start: qStart, end: qEnd.toISOString().split('T')[0], label: `Q${q} ${d.getUTCFullYear()}` });
      }
      d.setUTCMonth(d.getUTCMonth() + 3);
    }
  } else if (type === 'year') {
    const d = new Date(Date.UTC(earliest.getUTCFullYear(), 0, 1));
    while (d < now) {
      const start = d.toISOString().split('T')[0];
      const end = new Date(Date.UTC(d.getUTCFullYear(), 11, 31));
      if (end < now) {
        periods.push({ type: 'year', start, end: end.toISOString().split('T')[0], label: `${d.getUTCFullYear()}` });
      }
      d.setUTCFullYear(d.getUTCFullYear() + 1);
    }
  }

  return periods;
}

// ── LLM Provider ────────────────────────────────────────────────────────

type LLMProvider = {
  call(prompt: string, apiKey: string, model: string, maxTokens?: number): Promise<string>;
};

/** Read an OpenAI-compatible SSE stream (works for OpenAI and xAI). */
async function readOpenAIStream(resp: Response): Promise<string> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const event = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) text += delta;
      } catch { /* skip */ }
    }
  }
  return text.trim() || '{}';
}

const providers: Record<string, LLMProvider> = {
  anthropic: {
    async call(prompt, apiKey, model, maxTokens = 2000) {
      // Use streaming to prevent Cloudflare 524 timeouts on large/slow requests
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: model || 'claude-haiku-4-5', max_tokens: maxTokens, stream: true, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Anthropic API error ${resp.status}: ${body.slice(0, 300)}`);
      }
      // Read SSE stream and collect text deltas
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; delta?: { type: string; text?: string } };
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
              text += event.delta.text;
            }
          } catch { /* skip unparseable SSE lines */ }
        }
      }
      return text.trim() || '{}';
    },
  },
  openai: {
    async call(prompt, apiKey, model, maxTokens = 2000) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: model || 'gpt-4o-mini', max_tokens: maxTokens, stream: true, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`OpenAI API error ${resp.status}: ${body.slice(0, 300)}`);
      }
      return readOpenAIStream(resp);
    },
  },
  xai: {
    async call(prompt, apiKey, model, maxTokens = 2000) {
      const resp = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: model || 'grok-4-fast-non-reasoning', max_tokens: maxTokens, stream: true, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`xAI API error ${resp.status}: ${body.slice(0, 300)}`);
      }
      return readOpenAIStream(resp);
    },
  },
  google: {
    async call(prompt, apiKey, model, maxTokens = 2000) {
      const modelName = model || 'gemini-2.5-flash-lite';
      // Google uses streamGenerateContent with alt=sse for streaming
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Google API error ${resp.status}: ${body.slice(0, 300)}`);
      }
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6)) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
            const part = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (part) text += part;
          } catch { /* skip */ }
        }
      }
      return text.trim() || '{}';
    },
  },
};

function parseJSON<T>(raw: string): T | null {
  try {
    const cleaned = raw.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    // Try extracting JSON object from within surrounding text
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch { /* fall through */ }
    }
    return null;
  }
}

// ── Data Aggregation (stats-only, still needed for numbers) ─────────────

type AggregatedStats = Omit<InsightContent, 'summary' | 'highlights' | 'narrative' | 'recommendations' | 'project_areas' | 'interaction_style' | 'friction_analysis' | 'accomplishments' | 'facet_stats'>;

export async function aggregateInsightData(
  db: D1Database,
  scope: InsightScope,
  userId: string | null,
  periodStart: string,
  periodEnd: string,
): Promise<AggregatedStats> {
  const userFilter = scope === 'user' && userId ? ' AND s.user_id = ?' : '';
  const userFilterFO = scope === 'user' && userId ? ' AND fo.user_id = ?' : '';
  const userFilterO = scope === 'user' && userId ? ' AND (o.user_id_a = ? OR o.user_id_b = ?)' : '';
  const userParams = scope === 'user' && userId ? [userId] : [];
  const userParamsOverlap = scope === 'user' && userId ? [userId, userId] : [];

  const basicStats = await db.prepare(
    `SELECT COUNT(*) as total_sessions, COALESCE(SUM(s.total_cost_usd), 0) as total_cost_usd,
     COALESCE(AVG(s.duration_ms), 0) as avg_session_duration_ms,
     COALESCE(SUM(s.total_input_tokens), 0) as total_input_tokens,
     COALESCE(SUM(s.total_output_tokens), 0) as total_output_tokens
     FROM sessions s WHERE s.started_at >= ? AND s.started_at <= ?${userFilter}`
  ).bind(periodStart, periodEnd + 'T23:59:59', ...userParams).first<Record<string, number>>();

  const fileStats = await db.prepare(
    `SELECT COUNT(DISTINCT fo.file_path) as total_files_touched
     FROM file_operations fo JOIN sessions s ON fo.session_id = s.id
     WHERE s.started_at >= ? AND s.started_at <= ? AND fo.operation IN ('create', 'modify')${userFilterFO}`
  ).bind(periodStart, periodEnd + 'T23:59:59', ...userParams).first<{ total_files_touched: number }>();

  const promptStats = await db.prepare(
    `SELECT COUNT(*) as total_prompts FROM prompts p JOIN sessions s ON p.session_id = s.id
     WHERE s.started_at >= ? AND s.started_at <= ?${userFilter.replace('s.user_id', 'p.user_id')}`
  ).bind(periodStart, periodEnd + 'T23:59:59', ...userParams).first<{ total_prompts: number }>();

  const overlapStats = await db.prepare(
    `SELECT COUNT(*) as total_overlaps,
     SUM(CASE WHEN o.decision = 'block' THEN 1 ELSE 0 END) as total_blocks,
     SUM(CASE WHEN o.decision = 'warn' THEN 1 ELSE 0 END) as total_warns
     FROM overlaps o WHERE o.detected_at >= ? AND o.detected_at <= ?${userFilterO}`
  ).bind(periodStart, periodEnd + 'T23:59:59', ...userParamsOverlap).first<{ total_overlaps: number; total_blocks: number; total_warns: number }>();

  const byRepoResult = await db.prepare(
    `SELECT s.repo_name, COUNT(*) as session_count, COALESCE(SUM(s.total_cost_usd), 0) as cost
     FROM sessions s WHERE s.started_at >= ? AND s.started_at <= ?${userFilter}
     GROUP BY s.repo_name ORDER BY session_count DESC`
  ).bind(periodStart, periodEnd + 'T23:59:59', ...userParams).all();

  const repoFileCountResult = await db.prepare(
    `SELECT fo.repo_name, COUNT(DISTINCT fo.file_path) as file_count
     FROM file_operations fo JOIN sessions s ON fo.session_id = s.id
     WHERE s.started_at >= ? AND s.started_at <= ? AND fo.operation IN ('create', 'modify')${userFilterFO}
     GROUP BY fo.repo_name`
  ).bind(periodStart, periodEnd + 'T23:59:59', ...userParams).all();

  const repoFileCounts = new Map(
    repoFileCountResult.results.map((r: Record<string, unknown>) => [r.repo_name as string, r.file_count as number])
  );

  const byModelResult = await db.prepare(
    `SELECT COALESCE(s.model, 'Unknown') as model, COUNT(*) as session_count,
     COALESCE(SUM(s.total_cost_usd), 0) as cost FROM sessions s
     WHERE s.started_at >= ? AND s.started_at <= ?${userFilter}
     GROUP BY s.model ORDER BY session_count DESC`
  ).bind(periodStart, periodEnd + 'T23:59:59', ...userParams).all();

  const hottestResult = await db.prepare(
    `SELECT fo.file_path, fo.repo_name, COUNT(*) as edit_count, COUNT(DISTINCT fo.user_id) as user_count
     FROM file_operations fo JOIN sessions s ON fo.session_id = s.id
     WHERE s.started_at >= ? AND s.started_at <= ? AND fo.operation IN ('create', 'modify')${userFilterFO}
     GROUP BY fo.file_path, fo.repo_name ORDER BY edit_count DESC LIMIT 10`
  ).bind(periodStart, periodEnd + 'T23:59:59', ...userParams).all();

  const toolResult = await db.prepare(
    `SELECT fo.tool_name, COUNT(*) as count FROM file_operations fo JOIN sessions s ON fo.session_id = s.id
     WHERE s.started_at >= ? AND s.started_at <= ? AND fo.tool_name IS NOT NULL${userFilterFO}
     GROUP BY fo.tool_name ORDER BY count DESC`
  ).bind(periodStart, periodEnd + 'T23:59:59', ...userParams).all();

  return {
    stats: {
      total_sessions: basicStats?.total_sessions ?? 0,
      total_cost_usd: basicStats?.total_cost_usd ?? 0,
      total_input_tokens: basicStats?.total_input_tokens ?? 0,
      total_output_tokens: basicStats?.total_output_tokens ?? 0,
      total_files_touched: fileStats?.total_files_touched ?? 0,
      total_prompts: promptStats?.total_prompts ?? 0,
      avg_session_duration_ms: basicStats?.avg_session_duration_ms ?? 0,
      total_overlaps: overlapStats?.total_overlaps ?? 0,
      total_blocks: overlapStats?.total_blocks ?? 0,
      total_warns: overlapStats?.total_warns ?? 0,
    },
    by_repo: byRepoResult.results.map((r: Record<string, unknown>) => ({
      repo_name: r.repo_name as string,
      session_count: r.session_count as number,
      file_count: repoFileCounts.get(r.repo_name as string) ?? 0,
      cost: r.cost as number,
    })),
    by_model: byModelResult.results.map((r: Record<string, unknown>) => ({
      model: r.model as string,
      session_count: r.session_count as number,
      cost: r.cost as number,
    })),
    hottest_files: hottestResult.results.map((r: Record<string, unknown>) => ({
      file_path: r.file_path as string,
      repo_name: r.repo_name as string,
      edit_count: r.edit_count as number,
      user_count: r.user_count as number,
    })),
    tool_usage: toolResult.results.map((r: Record<string, unknown>) => ({
      tool_name: r.tool_name as string,
      count: r.count as number,
    })),
  };
}

// ── Layer 1: Per-Session Facet Generation ────────────────────────────────

// Batched facet prompt — analyzes multiple sessions in a single LLM call.
// This keeps external fetch count low: ceil(N/10) calls instead of N calls.
const BATCH_FACET_PROMPT = `You are analyzing coding sessions tracked by Overlap — a self-hosted team awareness tool for Claude Code. Overlap monitors what developers are working on, detects when teammates edit overlapping code areas, and generates productivity insights. These sessions come from Claude Code JSONL logs parsed by a tracer daemon, so data may be incomplete (truncated prompts, missing file context, partial session captures).

Sessions to analyze:
{sessions_block}

For EACH session, produce a JSON object with these fields:
- "session_key": The session key provided (MUST match exactly)
- "underlying_goal": What the developer was trying to build, fix, or ship (1-2 sentences). Focus on the concrete deliverable, not abstract descriptions.
- "goal_categories": Object mapping categories to counts. Categories: bug_fix, feature_development, refactoring, debugging, deployment, documentation, infrastructure, code_review, exploration, configuration
- "outcome": One of "fully_achieved", "mostly_achieved", "partially_achieved", "not_achieved". Infer from signals: many files edited with few prompts suggests productive flow; many prompts with few edits suggests struggle; very short sessions may be incomplete.
- "session_type": One of "single_task", "multi_task", "exploration", "debugging", "infrastructure"
- "friction_counts": Object mapping friction types to counts. Types: wrong_approach, repeated_errors, tool_limitation, unclear_requirements, environment_issue. Only include friction you can see evidence of in the prompts or file patterns. Empty object if none apparent.
- "friction_detail": Brief description of friction observed, or null if none
- "primary_success": The most notable thing accomplished (1 sentence), or null if unclear
- "brief_summary": 1-2 sentence summary of what happened in the session

Respond with ONLY a JSON array of objects. No markdown, no explanation.`;

type SessionContext = {
  session: Session;
  prompts: string[];
  files: string[];
};

/** Batch-fetch session contexts using db.batch() — one D1 round trip per chunk of 250 sessions. */
async function getSessionContexts(db: D1Database, sessions: Session[]): Promise<SessionContext[]> {
  if (sessions.length === 0) return [];

  const allContexts: SessionContext[] = [];

  // D1 batch limit is 500 statements; 2 per session = 250 sessions per batch
  const chunkSize = 250;
  for (let i = 0; i < sessions.length; i += chunkSize) {
    const chunk = sessions.slice(i, i + chunkSize);
    const stmts = chunk.flatMap(s => [
      db.prepare(`SELECT prompt_text FROM prompts WHERE session_id = ? ORDER BY turn_number ASC LIMIT 10`).bind(s.id),
      db.prepare(`SELECT DISTINCT file_path FROM file_operations WHERE session_id = ? AND operation IN ('create', 'modify') AND file_path IS NOT NULL LIMIT 15`).bind(s.id),
    ]);

    const results = await db.batch(stmts);

    for (let j = 0; j < chunk.length; j++) {
      const promptResult = results[j * 2] as D1Result<{ prompt_text: string | null }>;
      const fileResult = results[j * 2 + 1] as D1Result<{ file_path: string }>;
      allContexts.push({
        session: chunk[j],
        prompts: (promptResult.results || []).map(p => p.prompt_text || '').filter(Boolean),
        files: (fileResult.results || []).map(f => f.file_path),
      });
    }
  }

  return allContexts;
}

type FacetResult = {
  session_key: string;
  underlying_goal: string;
  goal_categories: Record<string, number>;
  outcome: string;
  session_type: string;
  friction_counts: Record<string, number>;
  friction_detail: string | null;
  primary_success: string | null;
  brief_summary: string;
};

/** Format a compact session block for the batched LLM prompt. */
function formatSessionBlock(ctx: SessionContext): string {
  const s = ctx.session;
  const durationMin = s.duration_ms ? Math.round(s.duration_ms / 60000) : 0;
  const lines = [
    `--- SESSION: ${s.id.substring(0, 8)} ---`,
    `Repo: ${s.repo_name} | Duration: ${durationMin}m | Turns: ${s.num_turns} | Cost: $${(s.total_cost_usd || 0).toFixed(4)}`,
  ];
  if (ctx.prompts.length > 0) {
    lines.push(`Prompts: ${ctx.prompts.slice(0, 5).map(p => p.substring(0, 200)).join(' | ')}`);
  }
  if (ctx.files.length > 0) {
    lines.push(`Files: ${ctx.files.slice(0, 10).join(', ')}`);
  }
  return lines.join('\n');
}

// Sessions per LLM call — must be high enough to minimize external fetches.
// Cloudflare waitUntil has a ~30s wall-clock limit, so fewer calls = better.
// 50 sessions per call keeps most weekly/monthly periods to 1 LLM call for facets.
const SESSIONS_PER_LLM_BATCH = 50;

export async function generateSessionFacets(
  db: D1Database,
  _scope: InsightScope,
  userId: string | null,
  periodStart: string,
  periodEnd: string,
  teamConfig: TeamConfig,
  encryptionKey: string,
  modelOverride?: string,
): Promise<{ generated: number; total: number }> {
  const sessions = await getSessionsWithoutFacets(db, userId, periodStart, periodEnd);
  if (sessions.length === 0) {
    return { generated: 0, total: 0 };
  }

  // Batch-fetch all session contexts (uses db.batch — one D1 round trip per 250)
  const contexts = await getSessionContexts(db, sessions);

  // No LLM configured — batch-write heuristic facets
  if (!teamConfig.llm_provider || teamConfig.llm_provider === 'heuristic' || !teamConfig.llm_api_key_encrypted) {
    await batchUpsertHeuristicFacets(db, contexts);
    return { generated: contexts.length, total: sessions.length };
  }

  const provider = providers[teamConfig.llm_provider];
  if (!provider) {
    await batchUpsertHeuristicFacets(db, contexts);
    return { generated: contexts.length, total: sessions.length };
  }

  const apiKey = await decrypt(teamConfig.llm_api_key_encrypted, encryptionKey);
  const model = modelOverride || teamConfig.llm_model || '';

  let generated = 0;
  const totalBatches = Math.ceil(contexts.length / SESSIONS_PER_LLM_BATCH);

  // Process in batches — each batch = 1 LLM call analyzing multiple sessions
  for (let i = 0; i < contexts.length; i += SESSIONS_PER_LLM_BATCH) {
    const batchNum = Math.floor(i / SESSIONS_PER_LLM_BATCH) + 1;
    const batch = contexts.slice(i, i + SESSIONS_PER_LLM_BATCH);
    console.log(`[facets] batch ${batchNum}/${totalBatches} (${batch.length} sessions)`);
    const sessionsBlock = batch.map(ctx => formatSessionBlock(ctx)).join('\n\n');
    const prompt = BATCH_FACET_PROMPT.replace('{sessions_block}', sessionsBlock);

    // Map session keys to contexts for matching results
    const keyToCtx = new Map(batch.map(ctx => [ctx.session.id.substring(0, 8), ctx]));

    try {
      // Single LLM call for the whole batch
      const maxTokens = Math.min(batch.length * 250, 4000);
      const raw = await provider.call(prompt, apiKey, model, maxTokens);
      const results = parseJSON<FacetResult[]>(raw);

      if (results && Array.isArray(results)) {
        // Match results to sessions and batch-write
        const facetsToWrite: Omit<SessionFacet, 'created_at'>[] = [];
        const matched = new Set<string>();

        for (const result of results) {
          const ctx = keyToCtx.get(result.session_key);
          if (ctx && !matched.has(ctx.session.id)) {
            matched.add(ctx.session.id);
            facetsToWrite.push({
              id: crypto.randomUUID(),
              session_id: ctx.session.id,
              user_id: ctx.session.user_id,
              underlying_goal: result.underlying_goal || null,
              goal_categories: JSON.stringify(result.goal_categories || {}),
              outcome: (result.outcome as SessionFacet['outcome']) || null,
              session_type: (result.session_type as SessionFacet['session_type']) || null,
              friction_counts: JSON.stringify(result.friction_counts || {}),
              friction_detail: result.friction_detail || null,
              primary_success: result.primary_success || null,
              brief_summary: result.brief_summary || null,
              model_used: model || teamConfig.llm_model || null,
              generated_at: new Date().toISOString(),
            });
          }
        }

        // Heuristic fallback for any sessions the LLM missed
        for (const ctx of batch) {
          if (!matched.has(ctx.session.id)) {
            facetsToWrite.push(buildHeuristicFacet(ctx));
          }
        }

        // Batch-write all facets in one D1 round trip
        await batchUpsertFacets(db, facetsToWrite);
        generated += batch.length;
      } else {
        // LLM returned unparseable response — heuristic fallback for whole batch
        await batchUpsertHeuristicFacets(db, batch);
        generated += batch.length;
      }
    } catch (err) {
      console.error(`Batch facet generation error:`, err);
      await batchUpsertHeuristicFacets(db, batch);
      generated += batch.length;
    }
  }

  return { generated, total: sessions.length };
}

/** Batch-write facets using db.batch() — one D1 round trip. */
async function batchUpsertFacets(db: D1Database, facets: Omit<SessionFacet, 'created_at'>[]): Promise<void> {
  if (facets.length === 0) return;
  const stmts = facets.map(f =>
    db.prepare(
      `INSERT INTO session_facets (id, session_id, user_id, underlying_goal, goal_categories, outcome, session_type, friction_counts, friction_detail, primary_success, brief_summary, model_used, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET underlying_goal = excluded.underlying_goal, goal_categories = excluded.goal_categories,
         outcome = excluded.outcome, session_type = excluded.session_type, friction_counts = excluded.friction_counts,
         friction_detail = excluded.friction_detail, primary_success = excluded.primary_success, brief_summary = excluded.brief_summary,
         model_used = excluded.model_used, generated_at = excluded.generated_at`
    ).bind(f.id, f.session_id, f.user_id, f.underlying_goal, f.goal_categories, f.outcome, f.session_type, f.friction_counts, f.friction_detail, f.primary_success, f.brief_summary, f.model_used, f.generated_at)
  );
  await db.batch(stmts);
}

/** Batch-write heuristic facets using db.batch() — one D1 round trip. */
async function batchUpsertHeuristicFacets(db: D1Database, contexts: SessionContext[]): Promise<void> {
  await batchUpsertFacets(db, contexts.map(ctx => buildHeuristicFacet(ctx)));
}

function buildHeuristicFacet(ctx: SessionContext): Omit<SessionFacet, 'created_at'> {
  const s = ctx.session;
  const goalHint = ctx.prompts[0]?.substring(0, 200) || 'Unknown task';
  const hasMultiplePrompts = ctx.prompts.length > 3;

  return {
    id: crypto.randomUUID(),
    session_id: s.id,
    user_id: s.user_id,
    underlying_goal: goalHint,
    goal_categories: JSON.stringify({ general_development: 1 }),
    outcome: s.num_turns > 0 ? 'mostly_achieved' : null,
    session_type: hasMultiplePrompts ? 'multi_task' : 'single_task',
    friction_counts: JSON.stringify({}),
    friction_detail: null,
    primary_success: null,
    brief_summary: `${s.num_turns}-turn session in ${s.repo_name}. ${ctx.files.length} files touched.`,
    model_used: null,
    generated_at: new Date().toISOString(),
  };
}

// ── Layer 2: Period Insight Synthesis ────────────────────────────────────

function aggregateFacets(facets: SessionFacet[]): InsightContent['facet_stats'] {
  const outcomes: Record<string, number> = {};
  const sessionTypes: Record<string, number> = {};
  const goalCategoryCounts: Record<string, number> = {};
  const frictionByType: Record<string, number> = {};
  let totalFriction = 0;

  for (const f of facets) {
    if (f.outcome) outcomes[f.outcome] = (outcomes[f.outcome] || 0) + 1;
    if (f.session_type) sessionTypes[f.session_type] = (sessionTypes[f.session_type] || 0) + 1;

    try {
      const cats: ParsedGoalCategories = f.goal_categories ? JSON.parse(f.goal_categories) : {};
      for (const [cat, count] of Object.entries(cats)) {
        goalCategoryCounts[cat] = (goalCategoryCounts[cat] || 0) + count;
      }
    } catch { /* skip */ }

    try {
      const friction: ParsedFrictionCounts = f.friction_counts ? JSON.parse(f.friction_counts) : {};
      for (const [type, count] of Object.entries(friction)) {
        frictionByType[type] = (frictionByType[type] || 0) + count;
        totalFriction += count;
      }
    } catch { /* skip */ }
  }

  const topGoals = Object.entries(goalCategoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([category, count]) => ({ category, count }));

  return {
    total_facets: facets.length,
    outcomes,
    session_types: sessionTypes,
    top_goal_categories: topGoals,
    total_friction_events: totalFriction,
    friction_by_type: frictionByType,
  };
}

const SYNTHESIS_PROMPT = `You are generating an insight report for Overlap — a self-hosted team awareness tool for Claude Code. Overlap tracks what developers are working on across repos, detects when teammates edit overlapping code areas ("overlaps"), and surfaces weekly/monthly productivity insights.

This report appears on the Overlap dashboard. Adapt your voice to the scope:
- If scope is "user": The reader IS the developer. Write directly to them using "you/your". Write like a sharp colleague reviewing their week — direct, specific, practical. Skip corporate language.
- If scope is "team": The reader is a team lead or the team collectively. Use "the team" or individual names where relevant. Focus on collaboration dynamics, cross-member patterns, who worked on what, and how work was distributed. Highlight overlap detections and coordination patterns.

IMPORTANT — Known data limitations:
- Cost, token counts, and model name may be zero or "Unknown" — this is normal tracer behavior, NOT a bug. Do not flag these as issues or recommend fixing them.
- Overlap counts (overlaps, blocks, warns) reflect detected conflicts with teammates on shared code areas. Zero overlaps is normal for solo work or well-coordinated teams — not a problem to diagnose.

Scope: {scope} ({scope_detail})
Period: {period_label} ({period_start} to {period_end})

QUANTITATIVE DATA:
{stats_json}

PER-SESSION ANALYSIS (each session was individually analyzed):
{facets_json}

Generate a JSON response with these fields:

1. "summary" - 2-3 sentence executive summary. Lead with what got built or shipped, not usage numbers. Be specific.

2. "highlights" - Array of 4-6 key highlights. Each should be a specific, insight-driven observation — not just restating numbers the user can already see. Focus on patterns, achievements, and notable behaviors. For team scope, highlight cross-member dynamics and workload distribution.

3. "project_areas" - Array of objects identifying distinct work themes. Each has:
   - "name": Short descriptive name (a feature or system, not just a repo name)
   - "session_count": Number of sessions attributable to this area. Must be realistic — counts across all areas should roughly sum to the total session count, not repeat it.
   - "description": 2-3 sentences about what was done and accomplished. For team scope, mention who contributed.

4. "interaction_style" - A paragraph (3-5 sentences). For user scope: how you interact with Claude Code — delegation style, error handling, session focus, iterative vs batch work. For team scope: how the team collectively uses Claude Code — who delegates heavily vs stays hands-on, common patterns, coordination style.

5. "friction_analysis" - Array of friction categories encountered. Each has:
   - "category": Name of friction type
   - "description": What happened and a concrete suggestion to reduce it
   - "examples": Array of 1-3 specific examples from sessions
   If no friction was detected, return an empty array. Do not speculate about missing instrumentation or fabricate friction.

6. "accomplishments" - Array of notable accomplishments. Each has:
   - "title": Short title
   - "description": What was impressive and why it matters — focus on the engineering outcome

7. "narrative" - 3-5 paragraph narrative telling the story of this period. What got built, what was hard, what patterns emerged, and where momentum is heading. Don't restate numbers already visible in the stats — focus on meaning, trade-offs, and trajectory. Reference specific repos and files. For team scope, weave in how different members' work connected or diverged.

8. "recommendations" - Array of actionable recommendations. Each has:
   - "title": Short actionable title
   - "description": A specific, implementable suggestion
   Recommendations should cover:
   - Coding workflow improvements (session focus, file organization, iteration patterns)
   - Prompting techniques (how to give Claude Code better context, structure prompts for complex tasks, use CLAUDE.md effectively, break down large tasks)
   - For team scope: collaboration improvements (reducing overlaps, coordinating on shared code, balancing workload)
   CRITICAL: Do NOT recommend fixing the tool's data quality, instrumentation, metadata tracking, or cost tracking. Focus entirely on how to work more effectively.

9. "member_insights" - (TEAM SCOPE ONLY — omit or set to null for user scope) Array of per-member breakdowns. Each has:
   - "name": The member's display name (from the facet data)
   - "session_count": Number of sessions this member had in the period
   - "focus_areas": Array of 2-4 strings describing what they primarily worked on
   - "strengths": 1-2 sentences on what they do well based on outcomes and patterns
   - "suggestion": A single actionable suggestion tailored to this member's patterns
   Focus on how each person contributes and how the team's work connects. Avoid generic commentary.

10. "environment_recommendations" - Array of concrete tooling/environment suggestions. Each has:
   - "type": One of "claude_md_rule" | "skill" | "mcp_server" | "workflow"
   - "title": Short descriptive title
   - "description": What it does and why it would help, based on observed patterns
   - "scope": "repo" | "global" — whether this applies to a specific repo or the user's whole environment
   - "repo": The repo name if scope is "repo", null otherwise
   - "example": A concrete example (e.g. the actual CLAUDE.md rule text, a skill invocation, a workflow command)
   Base suggestions on actual friction and patterns observed in the sessions. For user scope: recommend skills, CLAUDE.md rules, MCP servers, or workflows that would have helped. For team scope: recommend team-wide conventions, shared CLAUDE.md rules, or coordination workflows.

Respond with ONLY valid JSON (no markdown, no explanation).`;

type MemberInsight = {
  name: string;
  session_count: number;
  focus_areas: string[];
  strengths: string;
  suggestion: string;
};

type EnvironmentRecommendation = {
  type: 'claude_md_rule' | 'skill' | 'mcp_server' | 'workflow';
  title: string;
  description: string;
  scope: 'repo' | 'global';
  repo: string | null;
  example: string;
};

type SynthesisResult = {
  summary: string;
  highlights: string[];
  project_areas: Array<{ name: string; session_count: number; description: string }>;
  interaction_style?: string;
  friction_analysis: Array<{ category: string; description: string; examples: string[] }>;
  accomplishments: Array<{ title: string; description: string }>;
  narrative: string;
  recommendations: Array<{ title: string; description: string }>;
  member_insights?: MemberInsight[] | null;
  environment_recommendations?: EnvironmentRecommendation[] | null;
};

export async function generateInsightNarrative(
  db: D1Database,
  aggregated: AggregatedStats,
  facets: SessionFacet[],
  scope: InsightScope,
  scopeDetail: string,
  periodLabel: string,
  periodStart: string,
  periodEnd: string,
  teamConfig: TeamConfig,
  encryptionKey: string,
  modelOverride?: string,
): Promise<Omit<InsightContent, 'stats' | 'by_repo' | 'by_model' | 'hottest_files' | 'tool_usage'>> {
  const facetStats = aggregateFacets(facets);

  if (!teamConfig.llm_provider || teamConfig.llm_provider === 'heuristic' || !teamConfig.llm_api_key_encrypted) {
    return generateFallbackNarrative(aggregated, facetStats, scope, scopeDetail, periodLabel);
  }

  const provider = providers[teamConfig.llm_provider];
  if (!provider) {
    return generateFallbackNarrative(aggregated, facetStats, scope, scopeDetail, periodLabel);
  }

  const apiKey = await decrypt(teamConfig.llm_api_key_encrypted, encryptionKey);
  const model = modelOverride || teamConfig.llm_model || '';

  // For team scope, look up member display names so LLM can reference them
  let memberNames: Record<string, string> = {};
  if (scope === 'team') {
    const userIds = [...new Set(facets.map(f => f.user_id))];
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(',');
      const result = await db
        .prepare(`SELECT user_id, display_name FROM members WHERE user_id IN (${placeholders})`)
        .bind(...userIds)
        .all<{ user_id: string; display_name: string }>();
      memberNames = Object.fromEntries(result.results.map(m => [m.user_id, m.display_name]));
    }
  }

  // Build compact facet summaries for the synthesis prompt
  const facetSummaries = facets.slice(0, 50).map(f => ({
    ...(scope === 'team' ? { user_name: memberNames[f.user_id] || 'Unknown' } : {}),
    goal: f.underlying_goal,
    categories: f.goal_categories ? JSON.parse(f.goal_categories) : {},
    outcome: f.outcome,
    type: f.session_type,
    friction: f.friction_detail,
    success: f.primary_success,
    summary: f.brief_summary,
  }));

  const prompt = SYNTHESIS_PROMPT
    .replace('{scope}', scope)
    .replace('{scope_detail}', scopeDetail)
    .replace('{period_label}', periodLabel)
    .replace('{period_start}', periodStart)
    .replace('{period_end}', periodEnd)
    .replace('{stats_json}', JSON.stringify({ ...aggregated, facet_stats: facetStats }, null, 2))
    .replace('{facets_json}', JSON.stringify(facetSummaries, null, 2));

  const raw = await provider.call(prompt, apiKey, model, 8000);
  const result = parseJSON<SynthesisResult>(raw);

  if (!result) {
    console.error('[insight:narrative] LLM returned unparseable JSON. First 500 chars:', raw?.slice(0, 500));
    throw new Error(`LLM returned invalid JSON (${raw?.length || 0} chars). Try regenerating or use a different model.`);
  }

  return {
    facet_stats: facetStats,
    summary: result.summary || '',
    highlights: result.highlights || [],
    project_areas: result.project_areas || [],
    interaction_style: result.interaction_style,
    friction_analysis: result.friction_analysis || [],
    accomplishments: result.accomplishments || [],
    narrative: result.narrative || '',
    recommendations: result.recommendations || [],
    member_insights: result.member_insights || null,
    environment_recommendations: result.environment_recommendations || null,
  };
}

function generateFallbackNarrative(
  data: AggregatedStats,
  facetStats: InsightContent['facet_stats'],
  scope: InsightScope,
  scopeDetail: string,
  periodLabel: string,
): Omit<InsightContent, 'stats' | 'by_repo' | 'by_model' | 'hottest_files' | 'tool_usage'> {
  const s = data.stats;
  const subject = scope === 'user' ? scopeDetail : `The ${scopeDetail} team`;
  const avgMin = Math.round(s.avg_session_duration_ms / 60000);

  const topGoals = facetStats?.top_goal_categories?.slice(0, 3).map(g => g.category).join(', ') || 'general development';

  return {
    facet_stats: facetStats,
    summary: `${subject} completed ${s.total_sessions} sessions during ${periodLabel}, touching ${s.total_files_touched} files across ${data.by_repo.length} repos. Primary work: ${topGoals}. Total cost: $${s.total_cost_usd.toFixed(2)}.`,
    highlights: [
      `${s.total_sessions} coding sessions completed`,
      `${s.total_files_touched} unique files modified across ${data.by_repo.length} repos`,
      `${s.total_prompts} prompts sent, averaging ${avgMin} min/session`,
      s.total_overlaps > 0 ? `${s.total_overlaps} overlap${s.total_overlaps !== 1 ? 's' : ''} detected (${s.total_blocks} blocked)` : 'No overlaps detected',
    ],
    project_areas: data.by_repo.slice(0, 5).map(r => ({
      name: r.repo_name,
      session_count: r.session_count,
      description: `${r.session_count} sessions, ${r.file_count} files touched. Cost: $${r.cost.toFixed(2)}.`,
    })),
    friction_analysis: [],
    accomplishments: [],
    narrative: `During ${periodLabel}, ${subject.toLowerCase()} completed ${s.total_sessions} coding agent sessions with an average duration of ${avgMin} minutes. ${data.by_repo.length > 0 ? `Work spanned ${data.by_repo.length} repositor${data.by_repo.length !== 1 ? 'ies' : 'y'}, with ${data.by_repo[0]?.repo_name} seeing the most activity.` : ''}\n\n${data.tool_usage.length > 0 ? `Most used tools: ${data.tool_usage.slice(0, 3).map(t => t.tool_name).join(', ')}.` : ''} ${s.total_overlaps > 0 ? `${s.total_overlaps} overlaps detected, with ${s.total_blocks} blocked.` : 'No overlaps detected.'}\n\nConfigure an LLM provider in settings for richer AI-generated insights with behavioral analysis, friction patterns, and personalized recommendations.`,
    recommendations: [
      { title: 'Enable LLM Insights', description: 'Configure an LLM provider in settings for AI-generated behavioral analysis, friction patterns, and personalized recommendations.' },
    ],
  };
}

// ── Earliest Session Date ───────────────────────────────────────────────

export async function getEarliestSessionDate(
  db: D1Database,
  scope: InsightScope,
  userId: string | null,
): Promise<string | null> {
  const userFilter = scope === 'user' && userId ? ' AND user_id = ?' : '';
  const params = scope === 'user' && userId ? [userId] : [];
  const result = await db
    .prepare(`SELECT MIN(started_at) as earliest FROM sessions WHERE 1=1${userFilter}`)
    .bind(...params)
    .first<{ earliest: string | null }>();
  return result?.earliest?.split('T')[0] ?? null;
}
