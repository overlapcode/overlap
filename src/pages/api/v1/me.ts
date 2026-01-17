import type { APIContext } from 'astro';
import { authenticateAny, errorResponse, successResponse } from '@lib/auth/middleware';

export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const { user, team } = authResult.context;

  // Get the user's token from the database
  const userRecord = await db
    .prepare('SELECT user_token FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ user_token: string }>();

  return successResponse({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      user_token: userRecord?.user_token || null,
    },
    team: {
      id: team.id,
      name: team.name,
    },
  });
}
