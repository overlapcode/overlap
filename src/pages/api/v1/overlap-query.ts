/**
 * POST /api/v1/overlap-query
 *
 * Real-time overlap detection: the tracer sends the file it's about to edit
 * and the server checks for other users' active sessions touching the same file.
 * Returns overlap matches with tier classification, latest diffs, git state,
 * and a guidance note for the querying agent.
 *
 * Auth: Bearer {user_token}
 */

import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateTracer, errorResponse, successResponse } from '@lib/auth/middleware';
import { queryOverlapsForFile, getLatestEditsForSessions, createOverlap, getTeamConfig } from '@lib/db/queries';

const OverlapQuerySchema = z.object({
  repo_name: z.string().min(1),
  file_path: z.string().min(1),
  session_id: z.string().min(1),
  start_line: z.number().int().nullable().optional(),
  end_line: z.number().int().nullable().optional(),
  function_name: z.string().nullable().optional(),
});

type OverlapTier = 'line' | 'function' | 'adjacent' | 'file';
type OverlapDecision = 'proceed' | 'warn' | 'block';

type OverlapResult = {
  display_name: string;
  session_id: string;
  repo_name: string;
  started_at: string;
  summary: string | null;
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  function_name: string | null;
  tier: OverlapTier;
  last_touched_at: string;
  git_branch: string | null;
  is_pushed: boolean;
  latest_edit: {
    old_string: string | null;
    new_string: string | null;
    timestamp: string;
  } | null;
};

function computeTier(
  targetStart: number | null | undefined,
  targetEnd: number | null | undefined,
  regionStart: number | null,
  regionEnd: number | null,
  targetFn: string | null | undefined,
  regionFn: string | null,
): OverlapTier {
  // Line overlap check
  if (
    targetStart != null && targetEnd != null &&
    regionStart != null && regionEnd != null
  ) {
    if (targetStart <= regionEnd && targetEnd >= regionStart) {
      return 'line';
    }
    // Adjacency (within 30 lines)
    const gap = Math.min(
      Math.abs(targetStart - regionEnd),
      Math.abs(targetEnd - regionStart),
    );
    if (gap <= 30) {
      return 'adjacent';
    }
  }

  // Function overlap: both sides have function names and they match
  if (targetFn && regionFn && targetFn === regionFn) {
    return 'function';
  }

  return 'file';
}

/** Truncate a string to maxLen characters, appending "..." if truncated. */
function truncate(s: string | null, maxLen: number): string | null {
  if (!s) return s;
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
}

/** Build a human-readable region description like "queryFn() (lines 700-780)" */
function regionDesc(o: OverlapResult): string {
  if (o.function_name) {
    return o.start_line
      ? `${o.function_name}() (lines ${o.start_line}-${o.end_line})`
      : `${o.function_name}()`;
  }
  return o.start_line ? `lines ${o.start_line}-${o.end_line}` : o.file_path;
}

export async function POST(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Authenticate tracer
  const authResult = await authenticateTracer(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const { member } = authResult.context;

  // Parse and validate request body
  let query: z.infer<typeof OverlapQuerySchema>;
  try {
    const body = await context.request.json();
    query = OverlapQuerySchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
    }
    return errorResponse('Invalid JSON payload', 400);
  }

  // Use team's stale timeout as recency window for overlap detection
  const config = await getTeamConfig(db);
  const staleHours = config?.stale_timeout_hours ?? 8;

  // Query file operations from other users' active sessions
  const rows = await queryOverlapsForFile(
    db,
    query.repo_name,
    query.file_path,
    member.user_id,
    query.session_id,
    staleHours,
  );

  if (rows.length === 0) {
    return successResponse({ decision: 'proceed' as OverlapDecision, overlaps: [], guidance: null });
  }

  // Build user_id lookup from raw rows (needed for overlap logging)
  const sessionUserMap = new Map<string, string>();
  for (const row of rows) {
    sessionUserMap.set(row.session_id, row.user_id);
  }

  // Compute tiers for each row
  const tieredRows = rows.map((row) => ({
    ...row,
    tier: computeTier(
      query.start_line,
      query.end_line,
      row.start_line,
      row.end_line,
      query.function_name,
      row.function_name,
    ),
  }));

  // Sort: line > function > adjacent > file
  const tierOrder: Record<OverlapTier, number> = { line: 0, function: 1, adjacent: 2, file: 3 };
  tieredRows.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

  // Dedupe session+file pairs for the enrichment query
  const seen = new Set<string>();
  const sessionFilePairs: Array<{ sessionId: string; filePath: string }> = [];
  for (const row of tieredRows) {
    const key = `${row.session_id}:${row.file_path}`;
    if (!seen.has(key)) {
      seen.add(key);
      sessionFilePairs.push({ sessionId: row.session_id, filePath: row.file_path });
    }
  }

  // Fetch latest edits + push state for each overlapping session
  const latestEdits = await getLatestEditsForSessions(db, sessionFilePairs);
  const editMap = new Map(latestEdits.map((e) => [`${e.session_id}:${e.file_path}`, e]));

  // Build enriched overlap results
  const overlaps: OverlapResult[] = tieredRows.map((row) => {
    const edit = editMap.get(`${row.session_id}:${row.file_path}`);
    return {
      display_name: row.display_name,
      session_id: row.session_id,
      repo_name: row.repo_name,
      started_at: row.started_at,
      summary: row.summary,
      file_path: row.file_path,
      start_line: row.start_line,
      end_line: row.end_line,
      function_name: row.function_name,
      tier: row.tier,
      last_touched_at: row.last_touched_at,
      git_branch: row.git_branch,
      is_pushed: edit ? edit.has_push_after_edit === 1 : false,
      latest_edit: edit
        ? {
            old_string: truncate(edit.old_string, 500),
            new_string: truncate(edit.new_string, 500),
            timestamp: edit.edit_timestamp,
          }
        : null,
    };
  });

  // Only unpushed hard overlaps warrant a block — pushed changes just need a pull
  const hasUnpushedHardOverlap = overlaps.some(
    (o) => (o.tier === 'line' || o.tier === 'function') && !o.is_pushed
  );
  const decision = hasUnpushedHardOverlap ? 'block' as const : 'warn' as const;

  // Generate guidance note
  const hasAnyHardOverlap = overlaps.some((o) => o.tier === 'line' || o.tier === 'function');
  const guidance = buildGuidance(overlaps, hasAnyHardOverlap);

  // Side-effect: log hard overlaps to the overlaps table (deduped, via waitUntil)
  if (hasAnyHardOverlap) {
    const hardOverlaps = overlaps.filter((o) => o.tier === 'line' || o.tier === 'function');
    context.locals.runtime.ctx.waitUntil(
      logHardOverlaps(db, hardOverlaps, member.user_id, member.display_name, query.session_id, sessionUserMap, guidance, decision)
    );
  }

  return successResponse({ decision, overlaps, guidance });
}

/**
 * Build a guidance note based on overlap data.
 */
function buildGuidance(overlaps: OverlapResult[], hasHardOverlap: boolean): string {
  const lines: string[] = [];

  if (hasHardOverlap) {
    const hard = overlaps.filter((o) => o.tier === 'line' || o.tier === 'function');
    for (const o of hard) {
      const region = regionDesc(o);
      const branch = o.git_branch ? ` (branch '${o.git_branch}')` : '';

      if (o.is_pushed) {
        lines.push(
          `${o.display_name} edited ${region} and pushed${branch}. Check git origin for their changes — if you already pulled and this edit overwrites their work, decide whether to proceed or pull first.`
        );
      } else {
        lines.push(
          `${o.display_name} is actively editing ${region}${branch} (changes not yet pushed). Coordinate before modifying this region to avoid duplicated work.`
        );
      }

      if (o.latest_edit) {
        const old = o.latest_edit.old_string ? `"${o.latest_edit.old_string}"` : '(new content)';
        const nw = o.latest_edit.new_string ? `"${o.latest_edit.new_string}"` : '(deleted)';
        lines.push(`Latest change: ${old} → ${nw}`);
      }
    }
  } else {
    // Soft overlap — just awareness
    const first = overlaps[0];
    const branch = first.git_branch ? ` (branch '${first.git_branch}')` : '';
    lines.push(
      `${first.display_name} is working in the same file${branch}. Be aware of their changes near ${regionDesc(first)}.`
    );
  }

  return lines.join('\n');
}

/**
 * Log hard overlaps to the overlaps table with 24-hour dedup.
 * Runs in waitUntil() so it doesn't block the response.
 */
async function logHardOverlaps(
  db: import('@cloudflare/workers-types').D1Database,
  hardOverlaps: OverlapResult[],
  currentUserId: string,
  currentDisplayName: string,
  currentSessionId: string,
  sessionUserMap: Map<string, string>,
  guidance: string,
  decision: 'block' | 'warn',
): Promise<void> {
  for (const o of hardOverlaps) {
    try {
      const otherUserId = sessionUserMap.get(o.session_id) ?? '';
      if (!otherUserId) continue;

      // Dedup: skip if same pair + file + scope logged in last 24 hours
      const existing = await db.prepare(
        `SELECT id FROM overlaps
         WHERE type = 'file' AND file_path = ? AND repo_name = ? AND overlap_scope = ?
           AND ((user_id_a = ? AND user_id_b = ?) OR (user_id_a = ? AND user_id_b = ?))
           AND datetime(detected_at) > datetime('now', '-24 hours')
         LIMIT 1`
      ).bind(
        o.file_path, o.repo_name, o.tier,
        currentUserId, otherUserId, otherUserId, currentUserId
      ).first();

      if (existing) continue;

      await createOverlap(db, {
        type: 'file',
        severity: 'high',
        overlap_scope: o.tier as 'line' | 'function',
        file_path: o.file_path,
        directory_path: null,
        start_line: o.start_line,
        end_line: o.end_line,
        function_name: o.function_name,
        repo_name: o.repo_name,
        user_id_a: currentUserId,
        user_id_b: otherUserId,
        session_id_a: currentSessionId,
        session_id_b: o.session_id,
        description: guidance,
        decision,
      });
    } catch {
      // Non-critical — don't let logging failures affect anything
    }
  }
}
