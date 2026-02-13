/**
 * GET /api/v1/auth/verify
 *
 * Verify a user token (tracer binary calls this on join).
 * Returns member info if valid.
 *
 * Auth: Bearer {user_token}
 */

import type { APIContext } from 'astro';
import { authenticateTracer, errorResponse, successResponse } from '@lib/auth/middleware';

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Authenticate tracer
  const authResult = await authenticateTracer(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const { member, teamConfig } = authResult.context;

  return successResponse({
    user_id: member.user_id,
    display_name: member.display_name,
    team_name: teamConfig.team_name,
    role: member.role,
  });
}
