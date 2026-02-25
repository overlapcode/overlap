/**
 * GET /api/overlaps/:id - Overlap detail with file operations from both users
 *
 * :id is a UUID public_id, not an integer.
 * Auth: Web session
 */

import type { APIContext } from 'astro';
import { authenticateWebSession, errorResponse, successResponse } from '@lib/auth/middleware';
import { getOverlapDetail } from '@lib/db/queries';

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;
  const { id } = context.params;

  if (!id) {
    return errorResponse('Overlap ID required', 400);
  }

  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const detail = await getOverlapDetail(db, id);
  if (!detail) {
    return errorResponse('Overlap not found', 404);
  }

  return successResponse(detail);
}
