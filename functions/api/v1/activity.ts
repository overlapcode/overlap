import { authenticateRequest, errorResponse, successResponse } from '@lib/auth/middleware';
import { getRecentActivity } from '@lib/db/queries';

type Env = {
  DB: D1Database;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Authenticate
  const authResult = await authenticateRequest(request, env.DB);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }
  const { team } = authResult.context;

  // Parse query params
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 50;

  try {
    const activity = await getRecentActivity(env.DB, team.id, limit);

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
};
