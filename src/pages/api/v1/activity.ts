/**
 * GET /api/v1/activity - Main timeline endpoint (v2 compatible)
 *
 * Query params:
 * - view: 'timeline' | 'byUser'
 * - userId: Filter by user (for byUser view)
 * - limit: Max results (default 20)
 * - offset: Pagination offset
 * - includeStale: Include stale sessions (default true)
 */

import type { APIContext } from 'astro';
import { authenticateAny, errorResponse, successResponse } from '@lib/auth/middleware';
import { getSessions, markStaleSessions, deleteExpiredWebSessions, getAllMembers } from '@lib/db/queries';
import type { SessionWithMember } from '@lib/db/types';

/**
 * Format v2 session to match v1 UI expectations.
 * The UI components expect a specific shape, so we adapt the new schema.
 */
function formatSession(session: SessionWithMember) {
  return {
    id: session.id,
    user: {
      id: session.member.user_id,
      name: session.member.display_name,
    },
    device: {
      id: 'default', // v2 doesn't track devices
      name: 'local',
      is_remote: false,
    },
    repo: session.repo
      ? {
          id: session.repo.id,
          name: session.repo.name,
          remote_url: null, // v2 repos don't store remote_url
        }
      : {
          id: 'unknown',
          name: session.repo_name,
          remote_url: null,
        },
    branch: session.git_branch,
    worktree: null, // v2 doesn't track worktree separately
    status: session.status,
    started_at: session.started_at,
    last_activity_at: session.last_activity_at || session.started_at,
    ended_at: session.ended_at,
    // v2 specific fields
    model: session.model,
    total_cost_usd: session.total_cost_usd,
    num_turns: session.num_turns,
    duration_ms: session.duration_ms,
    // Activity content - use generated_summary from session
    activity: session.generated_summary || session.result_summary
      ? {
          semantic_scope: null, // v2 doesn't have semantic scope
          summary: session.generated_summary || session.result_summary,
          files: [], // Files are in file_operations table now
          created_at: session.started_at,
        }
      : null,
  };
}

export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate (supports both web session and tracer tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Parse query params
  const url = new URL(request.url);
  const view = url.searchParams.get('view') || 'timeline';
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const userIdParam = url.searchParams.get('userId');
  const includeStaleParam = url.searchParams.get('includeStale');

  const rawLimit = limitParam ? parseInt(limitParam, 10) : 20;
  const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);
  const rawOffset = offsetParam ? parseInt(offsetParam, 10) : 0;
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;
  const includeStale = includeStaleParam !== 'false';

  try {
    // On-demand cleanup: mark stale sessions and clean up expired tokens
    await Promise.all([markStaleSessions(db), deleteExpiredWebSessions(db)]);

    // Handle byUser view - return list of users with session counts
    if (view === 'byUser' && !userIdParam) {
      const members = await getAllMembers(db);

      // Get session counts per user
      const userStats = await db
        .prepare(
          `SELECT user_id, COUNT(*) as session_count, MAX(started_at) as latest_activity
           FROM sessions
           WHERE status IN ('active', 'stale')
           GROUP BY user_id`
        )
        .all<{ user_id: string; session_count: number; latest_activity: string }>();

      const statsMap = new Map(userStats.results.map((s) => [s.user_id, s]));

      const users = members
        .map((m) => {
          const stats = statsMap.get(m.user_id);
          return {
            userId: m.user_id,
            userName: m.display_name,
            sessionCount: stats?.session_count ?? 0,
            latestActivity: stats?.latest_activity ?? m.created_at,
          };
        })
        .filter((u) => u.sessionCount > 0)
        .sort((a, b) => new Date(b.latestActivity).getTime() - new Date(a.latestActivity).getTime());

      return successResponse({ users });
    }

    // Get sessions with filters
    const status = includeStale ? 'active_or_stale' : 'active';
    const result = await getSessions(db, {
      limit,
      offset,
      userId: userIdParam ?? undefined,
      status,
    });

    return successResponse({
      sessions: result.sessions.map(formatSession),
      total: result.total,
      limit,
      offset,
      hasMore: result.hasMore,
    });
  } catch (error) {
    console.error('Activity fetch error:', error);
    return errorResponse('Failed to fetch activity', 500);
  }
}
