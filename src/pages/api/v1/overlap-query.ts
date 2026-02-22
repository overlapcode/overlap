/**
 * POST /api/v1/overlap-query
 *
 * Real-time overlap detection: the tracer sends the file it's about to edit
 * and the server checks for other users' active sessions touching the same file.
 * Returns overlap matches with tier classification (line/function/adjacent/file).
 *
 * Auth: Bearer {user_token}
 */

import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateTracer, errorResponse, successResponse } from '@lib/auth/middleware';
import { queryOverlapsForFile, createOverlap } from '@lib/db/queries';

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

  // Query file operations from other users' active sessions
  const rows = await queryOverlapsForFile(
    db,
    query.repo_name,
    query.file_path,
    member.user_id,
    query.session_id,
  );

  if (rows.length === 0) {
    return successResponse({ decision: 'proceed' as OverlapDecision, overlaps: [] });
  }

  // Build user_id lookup from raw rows (needed for overlap logging)
  const sessionUserMap = new Map<string, string>();
  for (const row of rows) {
    sessionUserMap.set(row.session_id, row.user_id);
  }

  // Compute tiers for each row
  const overlaps: OverlapResult[] = rows.map((row) => ({
    display_name: row.display_name,
    session_id: row.session_id,
    repo_name: row.repo_name,
    started_at: row.started_at,
    summary: row.summary,
    file_path: row.file_path,
    start_line: row.start_line,
    end_line: row.end_line,
    function_name: row.function_name,
    tier: computeTier(
      query.start_line,
      query.end_line,
      row.start_line,
      row.end_line,
      query.function_name,
      row.function_name,
    ),
    last_touched_at: row.last_touched_at,
  }));

  // Sort: line > function > adjacent > file
  const tierOrder: Record<OverlapTier, number> = { line: 0, function: 1, adjacent: 2, file: 3 };
  overlaps.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

  const hasHardOverlap = overlaps.some((o) => o.tier === 'line' || o.tier === 'function');
  const decision: OverlapDecision = hasHardOverlap ? 'block' : 'warn';

  // Side-effect: log hard overlaps to the overlaps table (deduped, via waitUntil)
  if (hasHardOverlap) {
    const hardOverlaps = overlaps.filter((o) => o.tier === 'line' || o.tier === 'function');
    context.locals.runtime.ctx.waitUntil(
      logHardOverlaps(db, hardOverlaps, member.user_id, member.display_name, query.session_id, sessionUserMap)
    );
  }

  return successResponse({ decision, overlaps });
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
           AND detected_at > datetime('now', '-24 hours')
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
        description: `Real-time overlap detected: ${currentDisplayName} editing ${o.file_path} (${o.tier} overlap with ${o.display_name})`,
      });
    } catch {
      // Non-critical — don't let logging failures affect anything
    }
  }
}
