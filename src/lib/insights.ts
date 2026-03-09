/**
 * Two-Layer Insights Generation (v2 Prompt System)
 *
 * Layer 1: Per-session facet generation — each session is analyzed individually
 *          by LLM to extract goals, outcomes, friction, session type, etc.
 *
 * Layer 2: Period insight synthesis — aggregates all facets + stats for a period,
 *          then synthesizes a rich narrative report with project areas, behavioral
 *          analysis, friction patterns, accomplishments, and recommendations.
 *          Uses base prompt + scope instructions + period instructions.
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
  getTeamConfig,
  upsertInsight,
  getSessionFacetsForPeriod,
  getAllMembers,
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

const providers: Record<string, LLMProvider> = {
  anthropic: {
    async call(prompt, apiKey, model, maxTokens = 2000) {
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
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const evt = JSON.parse(line.slice(6)) as { type: string; delta?: { type: string; text?: string } };
            if (evt.type === 'content_block_delta' && evt.delta?.text) {
              text += evt.delta.text;
            }
          } catch { /* skip malformed SSE lines */ }
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
        body: JSON.stringify({ model: model || 'gpt-4o-mini', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`OpenAI API error ${resp.status}: ${body.slice(0, 300)}`);
      }
      const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
      return data.choices[0]?.message?.content?.trim() || '{}';
    },
  },
  xai: {
    async call(prompt, apiKey, model, maxTokens = 2000) {
      const resp = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: model || 'grok-4-fast-non-reasoning', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`xAI API error ${resp.status}: ${body.slice(0, 300)}`);
      }
      const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
      return data.choices[0]?.message?.content?.trim() || '{}';
    },
  },
  google: {
    async call(prompt, apiKey, model, maxTokens = 2000) {
      const modelName = model || 'gemini-2.5-flash-lite';
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Google API error ${resp.status}: ${body.slice(0, 300)}`);
      }
      const data = (await resp.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
      return data.candidates[0]?.content?.parts[0]?.text?.trim() || '{}';
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

type AggregatedStats = Omit<InsightContent, 'summary' | 'highlights' | 'narrative' | 'recommendations' | 'project_areas' | 'interaction_style' | 'friction_analysis' | 'accomplishments' | 'facet_stats' | 'top_actions' | 'trends' | 'outcome_analysis' | 'overlap_detail' | 'display_config'>;

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

// v2 Batched facet prompt — analyzes multiple sessions in a single LLM call.
const BATCH_FACET_PROMPT = `You are analyzing coding sessions tracked by Overlap — a self-hosted team awareness tool for coding agents. Overlap monitors what developers are working on, detects when teammates edit overlapping code areas, and generates productivity insights. These sessions come from Claude Code JSONL logs parsed by a tracer daemon.

DATA LIMITATIONS YOU MUST ACCOUNT FOR:
- Prompts may be truncated or summarized
- File lists may be incomplete (only edited files, not all read files)
- Cost and token data may be zero — this is normal tracer behavior, ignore it
- Very short sessions may be context-loading or interrupted — mark them accordingly
- Some sessions are continuations of previous work — note when prompts reference prior sessions

Sessions to analyze:
{sessions_block}

For EACH session, produce a JSON object with these fields:

"session_key": The session key provided (MUST match exactly)

"underlying_goal": What the developer was trying to build, fix, or ship (1-2 sentences). Focus on the concrete deliverable. If the session appears to be a continuation, note what it's continuing.

"goal_categories": Object mapping categories to counts. A session can span multiple categories. Categories: bug_fix, feature_development, refactoring, debugging, deployment, documentation, infrastructure, code_review, exploration, configuration, general_development

"outcome": One of "fully_achieved", "mostly_achieved", "partially_achieved", "not_achieved".

OUTCOME CALIBRATION — be realistic, not pessimistic:
- "fully_achieved": The stated or inferred goal was completed. Files were edited, the fix/feature appears done. Multi-file changes that span a full PR workflow (branch → implement → push) are fully achieved even if minor polish remains.
- "mostly_achieved": Core work was done but something minor is incomplete — a test not written, a follow-up task identified, a secondary goal deferred. This is the MOST COMMON outcome for productive sessions.
- "partially_achieved": Meaningful progress but the core goal isn't done — hit a blocker, pivoted mid-session, or the task was larger than expected. Investigation sessions that produce documented findings but no code changes are partially_achieved, not not_achieved.
- "not_achieved": The session produced no meaningful output — zero-turn sessions, sessions that failed to start, complete blocks with no workaround. A session where the developer explored and LEARNED something is at least partially_achieved.

If a session has many files edited and few friction signals, default toward "mostly_achieved" or "fully_achieved" — productive sessions are quiet sessions.

"session_type": One of "single_task", "multi_task", "exploration", "debugging", "infrastructure", "configuration"

"scope_ambition": One of "narrow" (1 file or 1 bug), "moderate" (2-5 files, 1 feature), "broad" (5+ files, multiple features or systems), "sweeping" (10+ files, cross-cutting changes). This helps calibrate whether partial completion is expected.

"friction_counts": Object mapping friction types to counts. Types: wrong_approach, repeated_errors, tool_limitation, unclear_requirements, environment_issue, session_interruption, overlapping_work. Only include friction you can see evidence of. Empty object {} if none apparent. DO NOT fabricate friction.

"friction_detail": Brief description of friction observed, or null if none. Include specific details: which file, what error, what was unclear.

"primary_success": The most notable thing accomplished (1 sentence), or null if the session produced no output.

"brief_summary": 1-2 sentence summary of what happened. For zero-turn or minimal sessions, say "Context-loading session with no substantive output" rather than guessing.

"continuation_signal": true if prompts reference previous sessions, prior work, or "continue", "pick up where", "last time". false otherwise.

"collaboration_signal": Brief note if prompts mention teammates, overlaps, or shared files. null if none.

Respond with ONLY a JSON array of objects. No markdown, no explanation, no preamble.`;

type ToolCounts = Record<string, number>;
type FileOpBreakdown = Array<{ file_path: string; operation: string; count: number }>;

type SessionContext = {
  session: Session;
  prompts: string[];
  files: string[];
  toolCounts: ToolCounts;
  fileOps: FileOpBreakdown;
  displayName?: string; // For team scope
};

type FacetResult = {
  session_key: string;
  underlying_goal: string;
  goal_categories: Record<string, number>;
  outcome: string;
  session_type: string;
  scope_ambition: 'narrow' | 'moderate' | 'broad' | 'sweeping';
  friction_counts: Record<string, number>;
  friction_detail: string | null;
  primary_success: string | null;
  brief_summary: string;
  continuation_signal: boolean;
  collaboration_signal: string | null;
};

/** Batch-fetch session contexts using db.batch() — one D1 round trip per chunk of ~165 sessions. */
async function getSessionContexts(db: D1Database, sessions: Session[], memberNames?: Record<string, string>): Promise<SessionContext[]> {
  if (sessions.length === 0) return [];

  const allContexts: SessionContext[] = [];

  // D1 batch limit is 500 statements; 3 per session = ~165 sessions per batch
  const chunkSize = 165;
  for (let i = 0; i < sessions.length; i += chunkSize) {
    const chunk = sessions.slice(i, i + chunkSize);
    const stmts = chunk.flatMap(s => [
      db.prepare(`SELECT prompt_text FROM prompts WHERE session_id = ? ORDER BY turn_number ASC LIMIT 10`).bind(s.id),
      db.prepare(`SELECT DISTINCT file_path FROM file_operations WHERE session_id = ? AND operation IN ('create', 'modify') AND file_path IS NOT NULL LIMIT 15`).bind(s.id),
      db.prepare(`SELECT tool_name, COUNT(*) as count FROM file_operations WHERE session_id = ? AND tool_name IS NOT NULL GROUP BY tool_name`).bind(s.id),
    ]);

    const results = await db.batch(stmts);

    for (let j = 0; j < chunk.length; j++) {
      const promptResult = results[j * 3] as D1Result<{ prompt_text: string | null }>;
      const fileResult = results[j * 3 + 1] as D1Result<{ file_path: string }>;
      const toolResult = results[j * 3 + 2] as D1Result<{ tool_name: string; count: number }>;

      const toolCounts: ToolCounts = {};
      for (const r of (toolResult.results || [])) {
        toolCounts[r.tool_name] = r.count;
      }

      // Fetch per-file operation breakdown (separate query since it can be large)
      const fileOps: FileOpBreakdown = [];

      allContexts.push({
        session: chunk[j],
        prompts: (promptResult.results || []).map(p => p.prompt_text || '').filter(Boolean),
        files: (fileResult.results || []).map(f => f.file_path),
        toolCounts,
        fileOps,
        displayName: memberNames?.[chunk[j].user_id],
      });
    }
  }

  // Fetch per-file operation breakdowns in a separate batch pass
  const fileOpChunkSize = 250;
  for (let i = 0; i < allContexts.length; i += fileOpChunkSize) {
    const chunk = allContexts.slice(i, i + fileOpChunkSize);
    const stmts = chunk.map(ctx =>
      db.prepare(
        `SELECT file_path, operation, COUNT(*) as count FROM file_operations WHERE session_id = ? AND file_path IS NOT NULL GROUP BY file_path, operation`
      ).bind(ctx.session.id)
    );

    const results = await db.batch(stmts);
    for (let j = 0; j < chunk.length; j++) {
      const fileOpResult = results[j] as D1Result<{ file_path: string; operation: string; count: number }>;
      chunk[j].fileOps = (fileOpResult.results || []).map(r => ({
        file_path: r.file_path,
        operation: r.operation,
        count: r.count,
      }));
    }
  }

  return allContexts;
}

/** Format a compact session block for the batched LLM prompt. */
function formatSessionBlock(ctx: SessionContext, scope: InsightScope): string {
  const s = ctx.session;
  const durationMin = s.duration_ms ? Math.round(s.duration_ms / 60000) : 0;
  const branch = s.git_branch || '';
  const filesTouched = ctx.files.length;

  const lines: string[] = [];

  // For team scope, prefix with user name
  if (scope === 'team' && ctx.displayName) {
    lines.push(`User: ${ctx.displayName}`);
  }

  lines.push(`--- SESSION: ${s.id.substring(0, 8)} ---`);

  // Header line with branch and files touched count
  let header = `Repo: ${s.repo_name}`;
  if (branch) header += ` | Branch: ${branch}`;
  header += ` | Duration: ${durationMin}m | Turns: ${s.num_turns} | Cost: $${(s.total_cost_usd || 0).toFixed(2)} | Files touched: ${filesTouched}`;
  lines.push(header);

  if (ctx.prompts.length > 0) {
    lines.push(`Prompts: ${ctx.prompts.slice(0, 5).map(p => p.substring(0, 200)).join(' | ')}`);
  }

  // Per-file operation breakdown with counts
  if (ctx.fileOps.length > 0) {
    const fileMap = new Map<string, string[]>();
    for (const op of ctx.fileOps) {
      const existing = fileMap.get(op.file_path) || [];
      const opLabel = op.count > 1 ? `${capitalize(op.operation)} x${op.count}` : capitalize(op.operation);
      existing.push(opLabel);
      fileMap.set(op.file_path, existing);
    }
    const fileEntries = [...fileMap.entries()].slice(0, 10).map(([path, ops]) => `${path} (${ops.join(', ')})`);
    lines.push(`Files: ${fileEntries.join(', ')}`);
  } else if (ctx.files.length > 0) {
    lines.push(`Files: ${ctx.files.slice(0, 10).join(', ')}`);
  }

  // Tool usage summary
  if (Object.keys(ctx.toolCounts).length > 0) {
    const toolStr = Object.entries(ctx.toolCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}: ${count}`)
      .join(', ');
    lines.push(`Tools: ${toolStr}`);
  }

  return lines.join('\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Sessions per LLM call — must be high enough to minimize external fetches.
// Cloudflare waitUntil has a ~30s wall-clock limit, so fewer calls = better.
// 50 sessions per call keeps most weekly/monthly periods to 1 LLM call for facets.
const SESSIONS_PER_LLM_BATCH = 50;

export async function generateSessionFacets(
  db: D1Database,
  scope: InsightScope,
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

  // For team scope, look up member names for session block formatting
  let memberNames: Record<string, string> | undefined;
  if (scope === 'team') {
    const members = await getAllMembers(db);
    memberNames = Object.fromEntries(members.map(m => [m.user_id, m.display_name]));
  }

  // Batch-fetch all session contexts (uses db.batch — one D1 round trip per ~165)
  const contexts = await getSessionContexts(db, sessions, memberNames);

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
    const sessionsBlock = batch.map(ctx => formatSessionBlock(ctx, scope)).join('\n\n');
    const prompt = BATCH_FACET_PROMPT.replace('{sessions_block}', sessionsBlock);

    // Map session keys to contexts for matching results
    const keyToCtx = new Map(batch.map(ctx => [ctx.session.id.substring(0, 8), ctx]));

    try {
      // Single LLM call for the whole batch
      const maxTokens = Math.min(batch.length * 350, 8000);
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
              scope_ambition: (result.scope_ambition as SessionFacet['scope_ambition']) || null,
              friction_counts: JSON.stringify(result.friction_counts || {}),
              friction_detail: result.friction_detail || null,
              primary_success: result.primary_success || null,
              brief_summary: result.brief_summary || null,
              continuation_signal: result.continuation_signal ?? false,
              collaboration_signal: result.collaboration_signal || null,
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
        console.error('[insight:facet] LLM returned unparseable JSON. Length:', raw?.length);
        console.error('[insight:facet] Response start:', raw?.slice(0, 1000));
        console.error('[insight:facet] Response end:', raw?.slice(-1000));
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
      `INSERT INTO session_facets (id, session_id, user_id, underlying_goal, goal_categories, outcome, session_type, friction_counts, friction_detail, primary_success, brief_summary, scope_ambition, continuation_signal, collaboration_signal, model_used, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET underlying_goal = excluded.underlying_goal, goal_categories = excluded.goal_categories,
         outcome = excluded.outcome, session_type = excluded.session_type, friction_counts = excluded.friction_counts,
         friction_detail = excluded.friction_detail, primary_success = excluded.primary_success, brief_summary = excluded.brief_summary,
         scope_ambition = excluded.scope_ambition, continuation_signal = excluded.continuation_signal, collaboration_signal = excluded.collaboration_signal,
         model_used = excluded.model_used, generated_at = excluded.generated_at`
    ).bind(f.id, f.session_id, f.user_id, f.underlying_goal, f.goal_categories, f.outcome, f.session_type, f.friction_counts, f.friction_detail, f.primary_success, f.brief_summary, f.scope_ambition, f.continuation_signal ? 1 : 0, f.collaboration_signal, f.model_used, f.generated_at)
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
  const fileCount = ctx.files.length;

  // Infer scope_ambition from file count
  let scopeAmbition: SessionFacet['scope_ambition'];
  if (fileCount >= 10) {
    scopeAmbition = 'sweeping';
  } else if (fileCount > 5) {
    scopeAmbition = 'broad';
  } else if (fileCount >= 2) {
    scopeAmbition = 'moderate';
  } else {
    scopeAmbition = 'narrow';
  }

  return {
    id: crypto.randomUUID(),
    session_id: s.id,
    user_id: s.user_id,
    underlying_goal: goalHint,
    goal_categories: JSON.stringify({ general_development: 1 }),
    outcome: s.num_turns > 0 ? 'mostly_achieved' : null,
    session_type: hasMultiplePrompts ? 'multi_task' : 'single_task',
    scope_ambition: scopeAmbition,
    friction_counts: JSON.stringify({}),
    friction_detail: null,
    primary_success: null,
    brief_summary: `${s.num_turns}-turn session in ${s.repo_name}. ${fileCount} files touched.`,
    continuation_signal: false,
    collaboration_signal: null,
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
  const scopeAmbitionCounts: Record<string, number> = {};
  let totalFriction = 0;

  for (const f of facets) {
    if (f.outcome) outcomes[f.outcome] = (outcomes[f.outcome] || 0) + 1;
    if (f.session_type) sessionTypes[f.session_type] = (sessionTypes[f.session_type] || 0) + 1;
    if (f.scope_ambition) scopeAmbitionCounts[f.scope_ambition] = (scopeAmbitionCounts[f.scope_ambition] || 0) + 1;

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
    scope_ambition_counts: scopeAmbitionCounts,
  };
}

// ── v2 Prompt Architecture: Base + Scope + Period ────────────────────────

const SYNTHESIS_BASE_PROMPT = `You are generating an insight report for Overlap — a self-hosted team awareness tool for coding agents. Overlap tracks what developers are working on across repos, detects when teammates edit overlapping code areas ("overlaps"), and surfaces periodic productivity insights.

This report appears on the Overlap dashboard. It should read like a sharp engineering colleague — direct, specific, practical. No corporate language, no filler.

CRITICAL DATA LIMITATIONS — DO NOT FLAG THESE AS ISSUES:
- Cost, token counts, and model name may be zero or "Unknown" — this is normal tracer behavior. Do not mention it, recommend fixing it, or include it in friction analysis.
- Avg session duration may be zero — same reason. Do not display or reference it.
- If a stat is zero and clearly broken (cost shows $0 for 100+ sessions), simply omit it from your narrative rather than displaying a wrong number.
- Overlap counts reflect detected conflicts. Zero overlaps is normal — not a problem.

Scope: {scope} ({scope_detail})
Period: {period_label} ({period_start} to {period_end})
Period type: {period_type}

===== SCOPE INSTRUCTIONS =====
{scope_instructions}
===== END SCOPE INSTRUCTIONS =====

===== PERIOD INSTRUCTIONS =====
{period_instructions}
===== END PERIOD INSTRUCTIONS =====

QUANTITATIVE DATA:
{stats_json}

COMPARISON DATA (previous period — null if first report):
{comparison_json}

OVERLAP DETAIL (may be empty):
{overlaps_json}

PER-SESSION ANALYSIS:
{facets_json}

Generate a JSON response with the following fields. Some fields are scope-dependent — follow the scope instructions to determine which to include and how to write them.

1. "top_actions" — Array of 2-3 highest-priority actions for the upcoming period. Single sentence each, imperative voice, specific. These appear as a callout box at the top of the report.

2. "summary" — Executive summary. Lead with what got BUILT or SHIPPED, not usage numbers.

3. "highlights" — Array of insight-driven observations. Not restated stats — patterns, achievements, notable behaviors.

4. "trends" — Period-over-period comparison object. Only include if {comparison_json} is not null. Fields:
   - "sessions_delta": e.g. "+12 sessions vs last period"
   - "completion_delta": e.g. "Fully achieved rate improved from 5% to 12%"
   - "friction_delta": e.g. "Friction events dropped from 28 to 20"
   - "narrative": 2-3 sentences interpreting what the trends mean
   Set to null if no comparison data.

5. "project_areas" — Array of distinct work themes. Each has:
   - "name": Short descriptive name
   - "session_count": Realistic count (should roughly sum to total sessions)
   - "description": What was done. See scope instructions for voice and attribution.
   - "status": "shipped" | "in_progress" | "stalled" | "planning"

6. "outcome_analysis" — Object analyzing session completion patterns:
   - "completion_breakdown": Object with counts per outcome level
   - "interpretation": 2-3 sentences. See scope + period instructions for calibration.
   - "highest_completion_pattern": What session type/scope had the best outcomes
   - "lowest_completion_pattern": What struggled

7. "interaction_style" — Paragraph on how coding agents are used. See scope instructions for framing.

8. "friction_analysis" — Array of friction categories. Each has:
   - "category": Name
   - "count": Number of events
   - "description": What happened and a concrete suggestion
   - "examples": Array of 1-3 specific examples
   - "escalation": (monthly+ only) "new" | "recurring" | "improving"
   Empty array if no friction. Do not fabricate.

9. "accomplishments" — Array. Each has:
   - "title": Short title
   - "description": What was impressive and why
   - "impact_estimate": Rough impact estimate, or null

10. "narrative" — Multi-paragraph narrative. See scope + period instructions for length, voice, and emphasis.

11. "overlap_detail" — Array of overlap events. See scope instructions for inclusion rules. Each has:
    - "users": Array of 2 user names
    - "file_path": Overlapped file
    - "scope": "line" | "function" | "file"
    - "description": What happened
    - "resolved": How it was resolved or if it's still a risk

12. "recommendations" — Array. Each has:
    - "title": Short actionable title
    - "description": Specific, implementable suggestion
    - "priority": "high" | "medium" | "low"
    CRITICAL: Do NOT recommend fixing instrumentation, metadata, cost tracking, or data quality.

13. "member_insights" — See scope instructions. Null for user scope.

14. "environment_recommendations" — Array. Each has:
    - "type": "claude_md_rule" | "skill" | "mcp_server" | "workflow"
    - "title": Short title
    - "description": What it does and why, based on OBSERVED patterns
    - "scope": "repo" | "global"
    - "repo": Repo name or null
    - "example": Concrete example text

15. "display_config" — Object controlling dashboard rendering:
    - "show_cost": boolean (true only if total_cost_usd > 0)
    - "show_avg_duration": boolean (true only if avg_session_duration_ms > 0)
    - "show_tokens": boolean (true only if total tokens > 0)
    - "show_trends": boolean (true only if comparison data exists)
    - "compact_repos": boolean (true if < 4 repos)
    - "compact_tools": boolean (true for weekly)

Respond with ONLY valid JSON. No markdown fences, no explanation, no preamble.`;

const USER_SCOPE_INSTRUCTIONS = `SCOPE: USER (Individual Developer Report)

VOICE: Write directly to the developer using "you/your". You are a sharp colleague reviewing their work — honest, specific, never condescending. The reader is the only person who will see this report.

SECTION BEHAVIOR:

"top_actions": Address the developer directly. "Split billing-tab.tsx before your next feature session." Not "The developer should..."

"summary": Lead with what YOU shipped. "You shipped the live demo call feature and pushed through 13+ PR fixes using a parallel agent workflow." Mention the repo by name.

"highlights": Focus on YOUR patterns — your strongest session, your biggest friction, your most-edited file, your tool usage signature. Do not reference or compare to teammates. Every highlight should be about your work, your habits, your output.

"project_areas": Describe what YOU worked on. Use "you" throughout. "You built out five delta variant environments..." not "Delta variant environments were built." Attribution is implicit — it's all you.

"outcome_analysis": Frame around YOUR habits. "Your single-task sessions targeting specific PRs had an 80% completion rate; your multi-task sessions attempting 3+ goals had 0%." Make it personal and actionable. The question is: what session patterns work best FOR YOU?

"interaction_style": Describe how YOU use Claude Code. Your delegation patterns, investigation habits, session structure, iteration style. "You lean heavily on Bash and Read before editing — your Read/Edit ratio of 1.4:1 shows careful investigation over rapid prototyping." This should feel like personalized coaching. Do not describe how the team uses it.

"friction_analysis": Frame as YOUR friction. "You hit unclear requirements 12 times..." Give suggestions YOU can implement unilaterally — CLAUDE.md rules, personal workflows, session habits. Do NOT suggest team process changes, standups, or things that require other people to change. Every suggestion should be something you control.

"accomplishments": YOUR accomplishments. What YOU built, shipped, or solved. Frame wins in terms of what they enable for your work going forward. No teammate mentions.

"narrative": Tell YOUR story this period. What did you set out to do? What actually happened? Where did you get stuck? Where are you heading next? Write in second person throughout. Reference your specific files, branches, and repos. This is your personal engineering journal entry — introspective but concrete.

"overlap_detail": Include ONLY overlaps involving you. Frame as: "You collided with [teammate] on [file]" with brief context on what you were each doing. This is the ONE place where teammate names appear in a user report. If you had zero overlaps, set to empty array and do not discuss.

"recommendations": Recommendations YOU can act on individually. Personal workflow changes, CLAUDE.md rules for your repos, session habits, prompting techniques. Do NOT recommend team-wide process changes, hiring, meetings, or things requiring other people to act. Every recommendation should be something you can do before your next session.

"member_insights": Set to null. This is a personal report. Never include this field.

"environment_recommendations": Tools and rules for YOUR environment. CLAUDE.md rules for your repos, skills for your workflow, MCP servers for your tools. Scoped to your work patterns. Don't recommend team-wide tooling changes.`;

const TEAM_SCOPE_INSTRUCTIONS = `SCOPE: TEAM (Team-Wide Report)

VOICE: Write about "the team" and use individual names when attributing work. The reader is a team lead, engineering manager, or the team reading collectively. Be analytical about team dynamics without being judgmental about individuals. This report may be shared in standups, retros, or with leadership.

SECTION BEHAVIOR:

"top_actions": Address the team lead or the team collectively. "Schedule a 15-minute sync between Michael and Iyanu on conversation_manager.py ownership." Frame as coordination and management actions.

"summary": Lead with what THE TEAM shipped collectively. Mention the top 2-3 contributors by name and what they drove. "The team shipped across a wide surface area — Omotayo closed 6+ backend issues, Michael pushed forward the delta experimentation layer, and Marvelous established a repeatable PR triage workflow." The summary should give a manager a 10-second understanding of the team's week/month.

"highlights": Focus on TEAM patterns — work distribution, collaboration dynamics, cross-member coordination, workload balance, overlap events. Include at least: one highlight about output distribution, one about coordination or overlap, and one about a notable individual contribution. "IncomingCallDemo.tsx had 110 edits from 2 contributors — it's the team's highest-traffic file and a coordination hotspot."

"project_areas": Describe what THE TEAM worked on. Attribute to specific people. "Omotayo tackled a cluster of backend issues... Michael pushed forward the delta infrastructure..." Each area should name who contributed. If multiple people contributed to one area, note how their work connected.

"outcome_analysis": Frame around TEAM patterns. Which members have the highest completion rates? Which session types work best across the team? Are there systemic patterns? "Omotayo's tightly-scoped sessions had 75% completion; multi-task sessions averaging 3+ goals team-wide had 10%." Look for systemic insights, not individual blame.

"interaction_style": Compare HOW different members use Claude Code. Contrast styles: "Omotayo operates in focused multi-file sprints; Michael interleaves exploration and implementation; Marvelous leverages automated skills for systematic PR triage." Note which styles correlate with better outcomes and where style differences create coordination risks (e.g., one person's exploration session touching files another person is actively editing).

"friction_analysis": Frame as TEAM friction. Which friction types affect multiple members vs just one person? "Unclear requirements affected 3 of 5 team members — this is a team-wide spec process gap, not an individual habit." Suggestions should be team-level: shared CLAUDE.md rules, team norms, communication protocols, pre-session checklists. For individual friction, note the person but frame the suggestion constructively.

"accomplishments": TEAM accomplishments. Credit individuals by name. "Omotayo's 6-Issue Backend Sprint resolved..." Include at least one collaborative accomplishment if any exists (e.g., two people's work combining to ship a feature).

"narrative": Tell THE TEAM'S story this period. How did different workstreams connect or diverge? Were there coordination gaps? Is workload balanced? Are there knowledge silos forming? Is anyone blocked, overloaded, or underutilized? Reference specific interactions between members. The narrative should help a manager understand team health and dynamics, not just output volume.

"overlap_detail": Include ALL overlaps between team members. This is a KEY section for team reports — managers read this first. For each overlap: who was involved, what file, what each person was working on, whether it caused a problem, and whether it's likely to recur. If zero overlaps, note it as a positive: "No overlaps detected — work was well-partitioned across the team this period."

"recommendations": Mix of individual and team-wide suggestions. LABEL CLEARLY: "For the team: establish a shared-file check-in norm" vs "For Iyanu: resolve npm permissions before next session." Include at least: one recommendation about team coordination/communication, one about workload distribution or specialization, and one about shared tooling or process. Individual suggestions should be constructive — frame as opportunities, not criticisms.

"member_insights": REQUIRED for team scope. Array of per-member breakdowns. Each has:
   - "name": Display name
   - "session_count": Their sessions this period
   - "completion_rate": % of sessions "fully_achieved" or "mostly_achieved"
   - "focus_areas": 2-4 strings describing their primary work
   - "strengths": 1-2 sentences on what they do well. Be specific and evidence-based — reference actual sessions, files, or patterns. Not generic praise.
   - "suggestion": ONE actionable suggestion tailored to THIS person's patterns THIS period. Not generic advice. "Your #120 sessions stalled when branch state wasn't pre-staged — add a checkout step before your first prompt."
   - "friction_rate": Their friction events / total sessions

   CRITICAL: Write about each person with respect. Strengths first, then the suggestion. Frame suggestions as opportunities for improvement, not failures. The person themselves WILL read this. Avoid: ranking members against each other, using words like "struggled" or "failed", or suggesting someone is underperforming without evidence.

"environment_recommendations": Tools and rules for THE TEAM's shared environment. Shared CLAUDE.md rules committed to repos, team-wide skills, coordination workflows. Every recommendation should help MULTIPLE team members, not just one. Scope to the team's shared repos and patterns.`;

const PERIOD_INSTRUCTIONS: Record<string, string> = {
  week: `PERIOD: WEEKLY
Tactical report. What happened this week? What should change next week?

LENGTH TARGETS:
- summary: 2 sentences
- highlights: 4 items max
- project_areas: 3-5 areas
- narrative: 2-3 short paragraphs
- recommendations: 3-5 items
- environment_recommendations: 2-3 items
- member_insights (team): 3-4 sentences per member

EMPHASIS:
- Lead with what SHIPPED or what's BLOCKED
- Friction: report specific incidents, not patterns (too few data points for pattern claims)
- Recommendations: immediate actions for next week, not structural changes
- outcome_analysis: Brief. Don't over-interpret small samples (5-15 sessions). Note the numbers but don't declare a crisis from one week.
- Do NOT suggest process overhauls from one week of data
- Accomplishments: concrete deliverables, not planning or exploration output

USER-WEEKLY: Focus on your most productive session vs your least productive. What was different? Give one specific habit to try next week. Keep the narrative tight — this is a check-in, not a retrospective.

TEAM-WEEKLY: Focus on who did what and any coordination issues. Was work well-distributed? Any blocks or overlaps? Keep per-member insights to a snapshot: what they did, one observation. Don't write behavioral profiles from 3-5 sessions per person.`,

  month: `PERIOD: MONTHLY
Pattern-recognition report. What trends emerged? What's working? What should change structurally?

LENGTH TARGETS:
- summary: 2-3 sentences
- highlights: 5-6 items
- project_areas: 4-7 areas
- narrative: 3-5 analytical paragraphs
- recommendations: 5-7 items
- environment_recommendations: 3-5 items
- member_insights (team): Full paragraph per member

EMPHASIS:
- Look for RECURRING PATTERNS across weeks, not one-off incidents
- Friction that appeared in multiple weeks is structural — escalate it with "recurring" flag
- outcome_analysis: This is the right timescale for meaningful completion analysis. Compare session types and scope ambitions. Identify which patterns correlate with success.
- Recommendations should be structural: process changes, CLAUDE.md rules, team norms
- Accomplishments should note cumulative impact over the month
- If comparison data exists, TRENDS is a key section — lead the narrative with what changed month-over-month

USER-MONTHLY: Identify your strongest and weakest session patterns with enough data to be confident. "Your single-task sessions had 80% completion; your multi-task sessions had 20%. The data says: scope tighter." Connect friction to habits, not isolated events. This is where CLAUDE.md rules and workflow skills become meaningful recommendations.

TEAM-MONTHLY: Analyze workload distribution (is someone overloaded or underutilized?), knowledge concentration (bus factor risks on specific files), and collaboration maturity (are overlaps decreasing?). Per-member insights should be substantive — identify growth, specialization, or areas where someone might need support. If comparison data exists, note who improved and who regressed.`,

  quarter: `PERIOD: QUARTERLY
Strategic report. How is the developer/team evolving? What capabilities were built?

LENGTH TARGETS:
- summary: 3 sentences
- highlights: 6 items
- project_areas: 5-10 areas (group by theme, not individual PRs)
- narrative: 5-7 paragraphs connecting themes across months
- recommendations: 5-8 items (mix tactical and strategic)
- environment_recommendations: 3-5 items
- member_insights (team): Full analysis with growth trajectory

EMPHASIS:
- CAPABILITY BUILDING: What can you/the team do now that you couldn't 3 months ago?
- VELOCITY TRAJECTORY: Are sessions getting more productive month over month?
- ARCHITECTURAL PATTERNS: Which codebase areas got the most investment? Under-invested areas?
- outcome_analysis: Compare completion rates across the quarter. Is there improvement?
- Don't enumerate individual sessions — synthesize at the theme level

USER-QUARTERLY: Reflect on how your relationship with coding agents has matured. Are you delegating more? Are your prompts getting sharper? What skills have you built? Where are you still fighting the tool? This is your quarterly developer growth check-in.

TEAM-QUARTERLY: Analyze team growth, role specialization, knowledge distribution, and collaboration maturity over 3 months. Are members developing distinct strengths? Is the team's coordination improving? Any ramp-up or turnover effects? Recommendations should include investment priorities for next quarter.`,

  year: `PERIOD: ANNUAL
Year-in-review. The big picture — what was built, how things changed, what the numbers mean at scale.

LENGTH TARGETS:
- summary: 3-4 sentences (most important summary you'll write)
- highlights: 6-8 items (only the most significant)
- project_areas: Major initiatives, not individual features
- narrative: 7-10 paragraphs (a short essay)
- recommendations: 5-8 strategic, forward-looking items
- environment_recommendations: 3-5 high-impact only
- member_insights (team): Comprehensive with year trajectory

EMPHASIS:
- WHAT GOT BUILT: Product and engineering outcomes first, process second
- EVOLUTION: How did agent usage change over the year? Early vs late sessions.
- SCALE: Interpret total numbers meaningfully — don't just list them
- INFLECTION POINTS: Months where productivity jumped or dropped, and why
- outcome_analysis: Year-scale gives enough data for real statistical claims

USER-ANNUAL: This is your annual developer retrospective. What did you build this year? How did your coding style evolve? What are you most proud of? What would you do differently? Write it as a reflection you'd want to revisit.

TEAM-ANNUAL: Team composition changes, emerging specializations, collaboration maturity arc, scaling effects. This report may be shared with leadership — maintain technical voice but ensure strategic clarity. Recommendations should be annual planning inputs.`,
};

type MemberInsight = {
  name: string;
  session_count: number;
  completion_rate?: number;
  focus_areas: string[];
  strengths: string;
  suggestion: string;
  friction_rate?: number;
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
  top_actions?: string[] | null;
  summary: string;
  highlights: string[];
  trends?: {
    sessions_delta: string;
    completion_delta: string;
    friction_delta: string;
    narrative: string;
  } | null;
  project_areas: Array<{ name: string; session_count: number; description: string; status?: 'shipped' | 'in_progress' | 'stalled' | 'planning' }>;
  outcome_analysis?: {
    completion_breakdown: Record<string, number>;
    interpretation: string;
    highest_completion_pattern: string;
    lowest_completion_pattern: string;
  } | null;
  interaction_style?: string;
  friction_analysis: Array<{ category: string; count?: number; description: string; examples: string[]; escalation?: 'new' | 'recurring' | 'improving' }>;
  accomplishments: Array<{ title: string; description: string; impact_estimate?: string | null }>;
  narrative: string;
  overlap_detail?: Array<{
    users: string[];
    file_path: string;
    scope: 'line' | 'function' | 'file';
    description: string;
    resolved: string;
  }> | null;
  recommendations: Array<{ title: string; description: string; priority?: 'high' | 'medium' | 'low' }>;
  member_insights?: MemberInsight[] | null;
  environment_recommendations?: EnvironmentRecommendation[] | null;
  display_config?: {
    show_cost: boolean;
    show_avg_duration: boolean;
    show_tokens: boolean;
    show_trends: boolean;
    compact_repos: boolean;
    compact_tools: boolean;
  } | null;
};

// ── Comparison & Overlap Data Helpers ────────────────────────────────────

type ComparisonData = {
  previous_period: string;
  stats: {
    total_sessions: number;
    total_files_touched: number;
    total_prompts: number;
    total_overlaps: number;
    total_friction_events: number;
  };
  facet_stats: {
    outcomes: Record<string, number>;
    friction_by_type: Record<string, number>;
  };
  previous_recommendations: string[];
};

type OverlapDetailRow = {
  file_path: string;
  overlap_scope: string;
  function_name: string | null;
  severity: string;
  decision: string | null;
  detected_at: string;
  description: string | null;
  user_a: string;
  user_b: string;
  session_a_summary: string | null;
  session_b_summary: string | null;
};

/** Get comparison data from the previous period's insight for trend analysis. */
async function getComparisonData(
  db: D1Database,
  scope: InsightScope,
  userId: string | null,
  periodType: InsightPeriodType,
  periodStart: string,
): Promise<ComparisonData | null> {
  const result = await db
    .prepare(
      `SELECT content FROM insights
       WHERE scope = ? AND COALESCE(user_id, '__team__') = ? AND period_type = ?
         AND period_start < ?
       ORDER BY period_start DESC
       LIMIT 1`
    )
    .bind(scope, scope === 'user' ? (userId || '__team__') : '__team__', periodType, periodStart)
    .first<{ content: string | null }>();

  if (!result?.content) return null;

  try {
    const prev = JSON.parse(result.content) as InsightContent;
    const prevFacetStats = prev.facet_stats;

    // Derive period label from stats
    const prevPeriodLabel = `Previous ${periodType}`;

    return {
      previous_period: prevPeriodLabel,
      stats: {
        total_sessions: prev.stats?.total_sessions ?? 0,
        total_files_touched: prev.stats?.total_files_touched ?? 0,
        total_prompts: prev.stats?.total_prompts ?? 0,
        total_overlaps: prev.stats?.total_overlaps ?? 0,
        total_friction_events: prevFacetStats?.total_friction_events ?? 0,
      },
      facet_stats: {
        outcomes: prevFacetStats?.outcomes ?? {},
        friction_by_type: prevFacetStats?.friction_by_type ?? {},
      },
      previous_recommendations: (prev.recommendations || []).map(r => r.title),
    };
  } catch {
    return null;
  }
}

/** Get overlap details for the period, optionally filtered by user. */
async function getOverlapDetails(
  db: D1Database,
  scope: InsightScope,
  userId: string | null,
  periodStart: string,
  periodEnd: string,
): Promise<OverlapDetailRow[]> {
  const userFilter = scope === 'user' && userId ? ' AND (o.user_id_a = ? OR o.user_id_b = ?)' : '';
  const userParams = scope === 'user' && userId ? [userId, userId] : [];

  const result = await db
    .prepare(
      `SELECT
          o.file_path,
          o.overlap_scope,
          o.function_name,
          o.severity,
          o.decision,
          o.detected_at,
          o.description,
          ma.display_name AS user_a,
          mb.display_name AS user_b,
          sa.generated_summary AS session_a_summary,
          sb.generated_summary AS session_b_summary
       FROM overlaps o
       JOIN members ma ON o.user_id_a = ma.user_id
       JOIN members mb ON o.user_id_b = mb.user_id
       LEFT JOIN sessions sa ON o.session_id_a = sa.id
       LEFT JOIN sessions sb ON o.session_id_b = sb.id
       WHERE o.detected_at >= ? AND o.detected_at <= ?${userFilter}
       ORDER BY o.detected_at DESC`
    )
    .bind(periodStart, periodEnd + 'T23:59:59', ...userParams)
    .all<OverlapDetailRow>();

  return result.results || [];
}

// ── Narrative Generation ────────────────────────────────────────────────

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
  periodType: InsightPeriodType,
  comparisonJson: string | null,
  overlapsJson: string | null,
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

  // Build compact facet summaries for the synthesis prompt — include new fields
  const facetSummaries = facets.slice(0, 50).map(f => ({
    ...(scope === 'team' ? { user_name: memberNames[f.user_id] || 'Unknown' } : {}),
    goal: f.underlying_goal,
    categories: f.goal_categories ? JSON.parse(f.goal_categories) : {},
    outcome: f.outcome,
    type: f.session_type,
    scope_ambition: f.scope_ambition || null,
    friction: f.friction_detail,
    success: f.primary_success,
    summary: f.brief_summary,
    continuation_signal: f.continuation_signal ?? false,
    collaboration_signal: f.collaboration_signal || null,
  }));

  // Build the prompt using base + scope + period instructions
  const scopeInstructions = scope === 'user' ? USER_SCOPE_INSTRUCTIONS : TEAM_SCOPE_INSTRUCTIONS;
  const periodInstructions = PERIOD_INSTRUCTIONS[periodType] || PERIOD_INSTRUCTIONS.week;

  const prompt = SYNTHESIS_BASE_PROMPT
    .replace('{scope}', scope)
    .replace('{scope_detail}', scopeDetail)
    .replace('{period_label}', periodLabel)
    .replace('{period_start}', periodStart)
    .replace('{period_end}', periodEnd)
    .replace('{period_type}', periodType)
    .replace('{scope_instructions}', scopeInstructions)
    .replace('{period_instructions}', periodInstructions)
    .replace('{stats_json}', JSON.stringify({ ...aggregated, facet_stats: facetStats }, null, 2))
    .replace('{comparison_json}', comparisonJson || 'null')
    .replace('{overlaps_json}', overlapsJson || '[]')
    .replace('{facets_json}', JSON.stringify(facetSummaries, null, 2));

  const raw = await provider.call(prompt, apiKey, model, 32000);
  const result = parseJSON<SynthesisResult>(raw);

  if (!result) {
    console.error('[insight:narrative] LLM returned unparseable JSON. Length:', raw?.length);
    console.error('[insight:narrative] Response start:', raw?.slice(0, 1000));
    console.error('[insight:narrative] Response end:', raw?.slice(-1000));
    throw new Error(`LLM returned invalid JSON (${raw?.length || 0} chars). Try regenerating or use a different model.`);
  }

  return {
    facet_stats: facetStats,
    top_actions: result.top_actions || null,
    summary: result.summary || '',
    highlights: result.highlights || [],
    trends: result.trends || null,
    project_areas: result.project_areas || [],
    outcome_analysis: result.outcome_analysis || null,
    interaction_style: result.interaction_style,
    friction_analysis: result.friction_analysis || [],
    accomplishments: result.accomplishments || [],
    narrative: result.narrative || '',
    overlap_detail: result.overlap_detail || null,
    recommendations: result.recommendations || [],
    member_insights: result.member_insights || null,
    environment_recommendations: result.environment_recommendations || null,
    display_config: result.display_config || null,
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
    top_actions: null,
    summary: `${subject} completed ${s.total_sessions} sessions during ${periodLabel}, touching ${s.total_files_touched} files across ${data.by_repo.length} repos. Primary work: ${topGoals}. Total cost: $${s.total_cost_usd.toFixed(2)}.`,
    highlights: [
      `${s.total_sessions} coding sessions completed`,
      `${s.total_files_touched} unique files modified across ${data.by_repo.length} repos`,
      `${s.total_prompts} prompts sent, averaging ${avgMin} min/session`,
      s.total_overlaps > 0 ? `${s.total_overlaps} overlap${s.total_overlaps !== 1 ? 's' : ''} detected (${s.total_blocks} blocked)` : 'No overlaps detected',
    ],
    trends: null,
    project_areas: data.by_repo.slice(0, 5).map(r => ({
      name: r.repo_name,
      session_count: r.session_count,
      description: `${r.session_count} sessions, ${r.file_count} files touched. Cost: $${r.cost.toFixed(2)}.`,
      status: 'in_progress' as const,
    })),
    outcome_analysis: null,
    friction_analysis: [],
    accomplishments: [],
    narrative: `During ${periodLabel}, ${subject.toLowerCase()} completed ${s.total_sessions} coding agent sessions with an average duration of ${avgMin} minutes. ${data.by_repo.length > 0 ? `Work spanned ${data.by_repo.length} repositor${data.by_repo.length !== 1 ? 'ies' : 'y'}, with ${data.by_repo[0]?.repo_name} seeing the most activity.` : ''}\n\n${data.tool_usage.length > 0 ? `Most used tools: ${data.tool_usage.slice(0, 3).map(t => t.tool_name).join(', ')}.` : ''} ${s.total_overlaps > 0 ? `${s.total_overlaps} overlaps detected, with ${s.total_blocks} blocked.` : 'No overlaps detected.'}\n\nConfigure an LLM provider in settings for richer AI-generated insights with behavioral analysis, friction patterns, and personalized recommendations.`,
    overlap_detail: null,
    recommendations: [
      { title: 'Enable LLM Insights', description: 'Configure an LLM provider in settings for AI-generated behavioral analysis, friction patterns, and personalized recommendations.', priority: 'high' as const },
    ],
    display_config: {
      show_cost: s.total_cost_usd > 0,
      show_avg_duration: s.avg_session_duration_ms > 0,
      show_tokens: (s.total_input_tokens + s.total_output_tokens) > 0,
      show_trends: false,
      compact_repos: data.by_repo.length < 4,
      compact_tools: true,
    },
  };
}

// ── Core Generation (shared by manual + auto-generate) ─────────────────

export async function runInsightGeneration(
  db: D1Database,
  opts: {
    insightId: string;
    scope: InsightScope;
    userId: string | null;
    periodType: InsightPeriodType;
    periodStart: string;
    periodEnd: string;
    periodLabel: string;
    scopeDetail: string;
    model: string | null;
    encryptionKey: string;
  },
): Promise<{ status: 'completed' | 'failed'; error?: string }> {
  const { insightId, scope, userId, periodType, periodStart, periodEnd, periodLabel, scopeDetail, model, encryptionKey } = opts;
  const teamConfig = await getTeamConfig(db);
  const teamLlmModel = teamConfig?.llm_model || null;

  const t0 = Date.now();
  const log = (stage: string, detail?: string) =>
    console.log(`[insight:${insightId.slice(0, 8)}] ${stage}${detail ? ` — ${detail}` : ''} (+${Date.now() - t0}ms)`);

  try {
    log('start', `scope=${scope} period=${periodStart}..${periodEnd} model=${model || 'default'}`);
    const aggregated = await aggregateInsightData(db, scope, userId, periodStart, periodEnd);
    log('aggregated', `${aggregated.stats.total_sessions} sessions, ${aggregated.stats.total_files_touched} files`);

    if (aggregated.stats.total_sessions === 0) {
      await upsertInsight(db, {
        id: insightId, scope, user_id: userId, period_type: periodType,
        period_start: periodStart, period_end: periodEnd, model_used: null,
        status: 'completed',
        content: JSON.stringify({
          ...aggregated,
          summary: 'No sessions recorded during this period.',
          highlights: ['No activity recorded'],
          project_areas: [], friction_analysis: [], accomplishments: [],
          narrative: 'There were no coding agent sessions during this period.',
          recommendations: [],
        }),
        error: null, generated_at: new Date().toISOString(),
      });
      log('complete', 'no sessions — saved empty insight');
      return { status: 'completed' };
    }

    // Layer 1: Per-session facets
    log('facets:start');
    try {
      const facetResult = await generateSessionFacets(db, scope, userId, periodStart, periodEnd, teamConfig!, encryptionKey, model || undefined);
      log('facets:done', `generated=${facetResult.generated} total=${facetResult.total}`);
    } catch (facetErr) {
      log('facets:error', facetErr instanceof Error ? facetErr.message : String(facetErr));
    }

    const facets = await getSessionFacetsForPeriod(db, userId, periodStart, periodEnd);
    log('facets:fetched', `${facets.length} facets for narrative`);

    // Fetch comparison data (previous period) and overlap details
    let comparisonJson: string | null = null;
    let overlapsJson: string | null = null;

    try {
      const comparisonData = await getComparisonData(db, scope, userId, periodType, periodStart);
      if (comparisonData) {
        comparisonJson = JSON.stringify(comparisonData, null, 2);
        log('comparison:found', `previous period: ${comparisonData.previous_period}`);
      } else {
        log('comparison:none', 'first report for this period type');
      }
    } catch (compErr) {
      log('comparison:error', compErr instanceof Error ? compErr.message : String(compErr));
    }

    try {
      const overlapDetails = await getOverlapDetails(db, scope, userId, periodStart, periodEnd);
      if (overlapDetails.length > 0) {
        overlapsJson = JSON.stringify(overlapDetails, null, 2);
        log('overlaps:found', `${overlapDetails.length} overlap events`);
      } else {
        log('overlaps:none');
      }
    } catch (overlapErr) {
      log('overlaps:error', overlapErr instanceof Error ? overlapErr.message : String(overlapErr));
    }

    // Layer 2: Narrative synthesis
    log('narrative:start');
    let synthesis;
    try {
      synthesis = await generateInsightNarrative(
        db, aggregated, facets, scope, scopeDetail, periodLabel,
        periodStart, periodEnd, teamConfig!, encryptionKey,
        periodType, comparisonJson, overlapsJson,
        model || undefined,
      );
      log('narrative:done');
    } catch (llmError) {
      const errMsg = llmError instanceof Error ? llmError.message : String(llmError);
      log('narrative:error', errMsg);
      synthesis = {
        summary: `${aggregated.stats.total_sessions} sessions during ${periodLabel}. (LLM analysis failed)`,
        highlights: [`${aggregated.stats.total_sessions} sessions`, `${aggregated.stats.total_files_touched} files touched`],
        project_areas: [], friction_analysis: [], accomplishments: [],
        narrative: 'LLM analysis unavailable — the report shows stats only. Check your API key in Settings.',
        recommendations: [{ title: 'LLM Error', description: errMsg }],
        llm_error: errMsg,
      };
    }

    await upsertInsight(db, {
      id: insightId, scope, user_id: userId, period_type: periodType,
      period_start: periodStart, period_end: periodEnd,
      model_used: model || teamLlmModel, status: 'completed',
      content: JSON.stringify({ ...aggregated, ...synthesis }),
      error: null, generated_at: new Date().toISOString(),
    });
    log('complete', `total ${Date.now() - t0}ms`);
    return { status: 'completed' };
  } catch (genError) {
    const errMsg = genError instanceof Error ? genError.message : 'Generation failed';
    log('FAILED', errMsg);
    await upsertInsight(db, {
      id: insightId, scope, user_id: userId, period_type: periodType,
      period_start: periodStart, period_end: periodEnd,
      model_used: model || teamLlmModel, status: 'failed',
      content: null, error: errMsg, generated_at: null,
    });
    return { status: 'failed', error: errMsg };
  }
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
