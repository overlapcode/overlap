import { authenticateRequest, errorResponse, successResponse } from '@lib/auth/middleware';
import { getSessionById, endSession } from '@lib/db/queries';

type Env = {
  DB: D1Database;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const sessionId = params.id as string;

  // Authenticate
  const authResult = await authenticateRequest(request, env.DB);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }
  const { user } = authResult.context;

  try {
    // Verify session exists and belongs to user
    const session = await getSessionById(env.DB, sessionId);
    if (!session) {
      return errorResponse('Session not found', 404);
    }
    if (session.user_id !== user.id) {
      return errorResponse('Session does not belong to user', 403);
    }

    // End the session
    await endSession(env.DB, sessionId);

    return successResponse({ ended: true });
  } catch (error) {
    console.error('End session error:', error);
    return errorResponse('Failed to end session', 500);
  }
};
