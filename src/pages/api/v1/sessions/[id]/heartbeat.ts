import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateRequest, errorResponse, successResponse } from '@lib/auth/middleware';
import { getSessionById, createActivity } from '@lib/db/queries';
import { generateId } from '@lib/utils/id';
import { classifyActivity } from '@lib/llm';

const HeartbeatSchema = z.object({
  files: z.array(z.string()),
  tool_name: z.string().optional(),
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

    // Rate limit: skip if last activity was < 15s ago
    const HEARTBEAT_MIN_INTERVAL_SECONDS = 15;
    // SQLite datetime('now') produces UTC without timezone suffix -- ensure UTC parse
    const lastActivityStr = session.last_activity_at.includes('Z')
      ? session.last_activity_at
      : session.last_activity_at.replace(' ', 'T') + 'Z';
    const lastActivity = new Date(lastActivityStr);
    const now = new Date();
    const elapsedSeconds = (now.getTime() - lastActivity.getTime()) / 1000;

    if (elapsedSeconds < HEARTBEAT_MIN_INTERVAL_SECONDS) {
      return successResponse({
        activity_id: null,
        throttled: true,
        retry_after: Math.ceil(HEARTBEAT_MIN_INTERVAL_SECONDS - elapsedSeconds),
      });
    }

    // Sanitize file paths before LLM classification
    const sanitizedFiles = input.files
      .map(f => f.replace(/[\x00-\x1f\x7f]/g, '').substring(0, 500))
      .slice(0, 50);

    // Classify the activity (pass tool_name for context)
    const classification = await classifyActivity(
      team,
      sanitizedFiles,
      encryptionKey,
      input.tool_name
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
