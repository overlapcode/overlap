/**
 * POST /api/members/:id/rotate-token - Rotate a member's token
 *
 * Auth: Web session (admin only)
 */

import type { APIContext } from 'astro';
import {
  authenticateWebSession,
  errorResponse,
  successResponse,
  generateToken,
  hashToken,
} from '@lib/auth/middleware';
import { getMemberById, updateMember } from '@lib/db/queries';

export async function POST(context: APIContext) {
  const db = context.locals.runtime.env.DB;
  const { id } = context.params;

  if (!id) {
    return errorResponse('Member ID required', 400);
  }

  // Require web session auth
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Check member exists
  const existing = await getMemberById(db, id);
  if (!existing) {
    return errorResponse('Member not found', 404);
  }

  // Generate new token
  const token = generateToken();
  const tokenHash = await hashToken(token);

  // Update token hash
  await updateMember(db, id, { token_hash: tokenHash });

  // Return new token (only time we return the raw token)
  return successResponse({
    user_id: existing.user_id,
    display_name: existing.display_name,
    token, // Only time we return the raw token
  });
}
