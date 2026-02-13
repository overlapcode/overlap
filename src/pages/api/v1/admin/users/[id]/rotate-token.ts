import type { APIContext } from 'astro';
import { authenticateAny, requireAdmin, errorResponse, successResponse, generateToken, hashToken } from '@lib/auth/middleware';
import { getMemberById, updateMember } from '@lib/db/queries';

export async function POST(context: APIContext) {
  const { request, params } = context;
  const userId = params.id as string;
  const db = context.locals.runtime.env.DB;

  // Authenticate and require admin
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  try {
    // Get member
    const member = await getMemberById(db, userId);
    if (!member) {
      return errorResponse('User not found', 404);
    }

    // Generate new token and hash it
    const newToken = generateToken();
    const tokenHash = await hashToken(newToken);

    await updateMember(db, userId, { token_hash: tokenHash });

    return successResponse({
      user_token: newToken,
      message: 'Token rotated successfully. User must update their tracer configuration.',
    });
  } catch (error) {
    console.error('Rotate token error:', error);
    return errorResponse('Failed to rotate token', 500);
  }
}
