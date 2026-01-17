import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateRequest, errorResponse, successResponse } from '@lib/auth/middleware';
import { checkForOverlaps } from '@lib/db/queries';
import { classifyActivity } from '@lib/llm';

const CheckSchema = z.object({
  files: z.array(z.string()),
});

export async function POST(context: APIContext) {
  const { request } = context;
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

  const parseResult = CheckSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const input = parseResult.data;

  try {
    // Classify the files to get semantic scope
    const classification = await classifyActivity(team, input.files, encryptionKey);

    // Check for overlaps
    const overlaps = await checkForOverlaps(
      db,
      team.id,
      user.id,
      input.files,
      classification.scope
    );

    return successResponse({
      has_overlaps: overlaps.length > 0,
      overlaps: overlaps.map((session) => ({
        user_name: session.user.name,
        device_name: session.device.name,
        is_remote: session.device.is_remote === 1,
        semantic_scope: session.latest_activity?.semantic_scope,
        summary: session.latest_activity?.summary,
        files: session.latest_activity?.files ?? [],
        last_activity_at: session.last_activity_at,
        started_at: session.started_at,
      })),
    });
  } catch (error) {
    console.error('Check overlaps error:', error);
    return errorResponse('Failed to check overlaps', 500);
  }
}
