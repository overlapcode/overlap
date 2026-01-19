import type { APIContext } from 'astro';
import type { SessionWithDetails } from '@lib/db/types';
import { authenticateAny, errorResponse, successResponse } from '@lib/auth/middleware';
import {
  getRecentActivity,
  getActivityByUser,
  getUserSessions,
  markStaleSessions,
  cleanupExpiredTokens,
} from '@lib/db/queries';

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
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }
  const { team } = authResult.context;

  // Parse query params
  const url = new URL(request.url);
  const view = url.searchParams.get('view') || 'timeline';
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const userIdParam = url.searchParams.get('userId');
  const includeStaleParam = url.searchParams.get('includeStale');

  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 20;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
  const includeStale = includeStaleParam !== 'false';

  try {
    // On-demand cleanup: mark stale sessions and clean up expired tokens
    // This replaces the cron job since Workers doesn't support scheduled triggers in deploy button
    await Promise.all([markStaleSessions(db), cleanupExpiredTokens(db)]);

    // Handle different view modes
    if (view === 'byUser' && !userIdParam) {
      // Return list of users with their session counts
      const users = await getActivityByUser(db, team.id, includeStale);
      return successResponse({ users });
    }

    if (view === 'byUser' && userIdParam) {
      // Return sessions for a specific user
      const result = await getUserSessions(db, team.id, userIdParam, {
        limit,
        offset,
        includeStale,
      });
      return successResponse({
        sessions: result.sessions.map(formatSession),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
      });
    }

    // Default: timeline view
    const result = await getRecentActivity(db, team.id, {
      limit,
      offset,
      includeStale,
    });

    return successResponse({
      sessions: result.sessions.map(formatSession),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore,
    });
  } catch (error) {
    console.error('Activity fetch error:', error);
    return errorResponse('Failed to fetch activity', 500);
  }
}
