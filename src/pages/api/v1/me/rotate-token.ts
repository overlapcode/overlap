/**
 * POST /api/v1/me/rotate-token
 *
 * Self-service token regeneration. Generates a new user token for the
 * currently authenticated user. The old token stops working immediately.
 */

import type { APIContext } from 'astro';
import { authenticateWebSession, errorResponse, successResponse, generateToken, hashToken } from '@lib/auth/middleware';
import { updateMember } from '@lib/db/queries';

export async function POST(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const { member } = authResult.context;

    const newToken = generateToken();
    const tokenHash = await hashToken(newToken);

    await updateMember(db, member.user_id, { token_hash: tokenHash });

    return successResponse({
      user_token: newToken,
      message: 'Token regenerated. Update your tracer with: overlap join',
    });
  } catch (error) {
    console.error('Rotate token error:', error);
    return errorResponse('Failed to regenerate token', 500);
  }
}
