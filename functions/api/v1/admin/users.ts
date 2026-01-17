import { authenticateRequest, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getTeamUsers } from '@lib/db/queries';

type Env = {
  DB: D1Database;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Authenticate and require admin
  const authResult = await authenticateRequest(request, env.DB);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  const { team } = authResult.context;

  try {
    const users = await getTeamUsers(env.DB, team.id);

    return successResponse({
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_active: user.is_active === 1,
        stale_timeout_hours: user.stale_timeout_hours,
        created_at: user.created_at,
      })),
    });
  } catch (error) {
    console.error('List users error:', error);
    return errorResponse('Failed to list users', 500);
  }
};
