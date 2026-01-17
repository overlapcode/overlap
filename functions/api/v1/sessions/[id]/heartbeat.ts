import { z } from 'zod';
import { authenticateRequest, errorResponse, successResponse } from '@lib/auth/middleware';
import { getSessionById, createActivity } from '@lib/db/queries';
import { generateId } from '@lib/utils/id';
import { classifyActivity } from '@lib/llm';

const HeartbeatSchema = z.object({
  files: z.array(z.string()),
});

type Env = {
  DB: D1Database;
  TEAM_ENCRYPTION_KEY?: string;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const sessionId = params.id as string;

  // Authenticate
  const authResult = await authenticateRequest(request, env.DB);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }
  const { user, team } = authResult.context;

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parseResult = HeartbeatSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const input = parseResult.data;

  try {
    // Verify session exists and belongs to user
    const session = await getSessionById(env.DB, sessionId);
    if (!session) {
      return errorResponse('Session not found', 404);
    }
    if (session.user_id !== user.id) {
      return errorResponse('Session does not belong to user', 403);
    }

    // Classify the activity
    const classification = await classifyActivity(
      team,
      input.files,
      env.TEAM_ENCRYPTION_KEY
    );

    // Create activity record
    const activity = await createActivity(env.DB, {
      id: generateId(),
      session_id: sessionId,
      files: JSON.stringify(input.files),
      semantic_scope: classification.scope,
      summary: classification.summary,
    });

    return successResponse({
      activity_id: activity.id,
      semantic_scope: classification.scope,
      summary: classification.summary,
    });
  } catch (error) {
    console.error('Heartbeat error:', error);
    return errorResponse('Failed to record activity', 500);
  }
};
