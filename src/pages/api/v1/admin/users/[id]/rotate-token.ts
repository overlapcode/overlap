import type { APIContext } from 'astro';
import { authenticateRequest, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getUserById } from '@lib/db/queries';
import { generateToken } from '@lib/utils/id';

export async function POST(context: APIContext) {
  const { request, params } = context;
  const userId = params.id as string;
  const db = context.locals.runtime.env.DB;

  // Authenticate and require admin
  const authResult = await authenticateRequest(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  try {
    // Get user
    const user = await getUserById(db, userId);
    if (!user) {
      return errorResponse('User not found', 404);
    }

    // Generate new token
    const newToken = generateToken();

    await db
      .prepare("UPDATE users SET user_token = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(newToken, userId)
      .run();

    return successResponse({
      user_token: newToken,
      message: 'Token rotated successfully. User must update their plugin configuration.',
    });
  } catch (error) {
    console.error('Rotate token error:', error);
    return errorResponse('Failed to rotate token', 500);
  }
}
