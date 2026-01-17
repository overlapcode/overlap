import { authenticateRequest, errorResponse, successResponse } from '@lib/auth/middleware';
import { getActiveSessionsForUser } from '@lib/db/queries';

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
  const { user, team } = authResult.context;

  try {
    const activeSessions = await getActiveSessionsForUser(env.DB, user.id);

    return successResponse({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        stale_timeout_hours: user.stale_timeout_hours ?? team.stale_timeout_hours,
      },
      team: {
        id: team.id,
        name: team.name,
        is_public: team.is_public === 1,
      },
      active_sessions: activeSessions.length,
    });
  } catch (error) {
    console.error('User info error:', error);
    return errorResponse('Failed to fetch user info', 500);
  }
};
