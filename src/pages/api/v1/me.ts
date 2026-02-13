import type { APIContext } from 'astro';
import { authenticateAny, errorResponse, successResponse } from '@lib/auth/middleware';

/**
 * GET /api/v1/me
 * Get information about the currently authenticated user/session.
 */
export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const { member, teamConfig } = authResult.context;

  return successResponse({
    user: {
      id: member.user_id,
      name: member.display_name,
      email: member.email,
      role: member.role,
    },
    team: {
      name: teamConfig.team_name,
    },
  });
}
