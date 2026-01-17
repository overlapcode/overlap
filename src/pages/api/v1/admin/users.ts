import type { APIContext } from 'astro';
import { authenticateAny, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getTeamUsers } from '@lib/db/queries';

export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate and require admin (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  const { team } = authResult.context;

  try {
    const users = await getTeamUsers(db, team.id);

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
}
