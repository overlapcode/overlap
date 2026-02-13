/**
 * GET /api/sessions/:id - Session detail with file ops and prompts
 *
 * Auth: Web session or tracer token
 */

import type { APIContext } from 'astro';
import { authenticateAny, errorResponse, successResponse } from '@lib/auth/middleware';
import { getSessionDetail } from '@lib/db/queries';

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;
  const { id } = context.params;

  if (!id) {
    return errorResponse('Session ID required', 400);
  }

  // Require auth (web or tracer)
  const authResult = await authenticateAny(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const session = await getSessionDetail(db, id);

  if (!session) {
    return errorResponse('Session not found', 404);
  }

  return successResponse(session);
}
