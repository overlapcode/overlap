import { authenticateRequest, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getUserById } from '@lib/db/queries';
import { generateToken } from '@lib/utils/id';

type Env = {
  DB: D1Database;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const userId = params.id as string;

  // Authenticate and require admin
  const authResult = await authenticateRequest(request, env.DB);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  try {
    // Get user
    const user = await getUserById(env.DB, userId);
    if (!user) {
      return errorResponse('User not found', 404);
    }

    // Generate new token
    const newToken = generateToken();

    await env.DB
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
};
