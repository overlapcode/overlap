import type { APIContext } from 'astro';
import type { SessionWithDetails } from '@lib/db/types';
import { authenticateAny, errorResponse, successResponse } from '@lib/auth/middleware';
import { getRepoActivity, getRepoBranches, getRepoUsers } from '@lib/db/queries';

function formatSession(session: SessionWithDetails) {
  return {
    id: session.id,
    user: session.user,
    device: {
      id: session.device.id,
      name: session.device.name,
      is_remote: session.device.is_remote === 1,
    },
    repo: session.repo,
    branch: session.branch,
    worktree: session.worktree,
    status: session.status,
    started_at: session.started_at,
    last_activity_at: session.last_activity_at,
    activity: session.latest_activity
      ? {
          semantic_scope: session.latest_activity.semantic_scope,
          summary: session.latest_activity.summary,
          files: session.latest_activity.files,
          created_at: session.latest_activity.created_at,
        }
      : null,
  };
}

export async function GET(context: APIContext) {
  const { request, params } = context;
  const db = context.locals.runtime.env.DB;
  const repoId = params.id;

  if (!repoId) {
    return errorResponse('Repo ID is required', 400);
  }

  // Authenticate
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }
  const { team } = authResult.context;

  // Verify repo belongs to team
  const repo = await db
    .prepare('SELECT * FROM repos WHERE id = ? AND team_id = ?')
    .bind(repoId, team.id)
    .first();

  if (!repo) {
    return errorResponse('Repository not found', 404);
  }

  // Parse query params
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const includeStaleParam = url.searchParams.get('includeStale');
  const userId = url.searchParams.get('userId') || undefined;
  const branch = url.searchParams.get('branch') || undefined;
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;

  const rawLimit = limitParam ? parseInt(limitParam, 10) : 20;
  const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);
  const rawOffset = offsetParam ? parseInt(offsetParam, 10) : 0;
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;
  const includeStale = includeStaleParam !== 'false';

  try {
    // Fetch sessions, branches, and users in parallel
    const [result, branches, users] = await Promise.all([
      getRepoActivity(db, team.id, repoId, {
        limit,
        offset,
        includeStale,
        userId,
        branch,
        startDate,
        endDate,
      }),
      getRepoBranches(db, repoId),
      getRepoUsers(db, repoId),
    ]);

    return successResponse({
      sessions: result.sessions.map(formatSession),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore,
      filters: {
        branches,
        users,
      },
    });
  } catch (error) {
    console.error('Repo activity fetch error:', error);
    return errorResponse('Failed to fetch repo activity', 500);
  }
}
