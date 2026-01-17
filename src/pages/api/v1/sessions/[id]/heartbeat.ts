import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateRequest, errorResponse, successResponse } from '@lib/auth/middleware';
import { getSessionById, createActivity } from '@lib/db/queries';
import { generateId } from '@lib/utils/id';
import { classifyActivity } from '@lib/llm';

const HeartbeatSchema = z.object({
  files: z.array(z.string()),
});

export async function POST(context: APIContext) {
  const { request, params } = context;
  const sessionId = params.id as string;
  const db = context.locals.runtime.env.DB;
  const encryptionKey = context.locals.runtime.env.TEAM_ENCRYPTION_KEY;

  // Authenticate
  const authResult = await authenticateRequest(request, db);
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
    const session = await getSessionById(db, sessionId);
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
      encryptionKey
    );

    // Create activity record
    const activity = await createActivity(db, {
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
}
