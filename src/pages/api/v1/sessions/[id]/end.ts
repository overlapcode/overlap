import type { APIContext } from 'astro';
import { authenticateRequest, errorResponse, successResponse } from '@lib/auth/middleware';
import { getSessionById, endSession } from '@lib/db/queries';

export async function POST(context: APIContext) {
  const { request, params } = context;
  const sessionId = params.id as string;
  const db = context.locals.runtime.env.DB;

  // Authenticate
  const authResult = await authenticateRequest(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }
  const { user } = authResult.context;

  try {
    // Verify session exists and belongs to user
    const session = await getSessionById(db, sessionId);
    if (!session) {
      return errorResponse('Session not found', 404);
    }
    if (session.user_id !== user.id) {
      return errorResponse('Session does not belong to user', 403);
    }

    // End the session
    await endSession(db, sessionId);

    return successResponse({ ended: true });
  } catch (error) {
    console.error('End session error:', error);
    return errorResponse('Failed to end session', 500);
  }
}
