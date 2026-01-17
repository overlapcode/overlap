import type { APIContext } from 'astro';
import { authenticateRequest, errorResponse, successResponse } from '@lib/auth/middleware';
import { getRecentActivity, markStaleSessions, cleanupExpiredTokens } from '@lib/db/queries';

export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate
  const authResult = await authenticateRequest(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }
  const { team } = authResult.context;

  // Parse query params
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 50;

  try {
    // On-demand cleanup: mark stale sessions and clean up expired tokens
    // This replaces the cron job since Workers doesn't support scheduled triggers in deploy button
    await Promise.all([
      markStaleSessions(db),
      cleanupExpiredTokens(db),
    ]);

    const activity = await getRecentActivity(db, team.id, limit);

    return successResponse({
      sessions: activity.map((session) => ({
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
      })),
    });
  } catch (error) {
    console.error('Activity fetch error:', error);
    return errorResponse('Failed to fetch activity', 500);
  }
}
