import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateRequest, errorResponse, successResponse } from '@lib/auth/middleware';
import { createSession, getOrCreateDevice, getOrCreateRepo } from '@lib/db/queries';
import { generateId } from '@lib/utils/id';

const StartSessionSchema = z.object({
  session_id: z.string().optional(), // Client can provide Claude Code session ID
  device_name: z.string(),
  hostname: z.string(),
  is_remote: z.boolean().default(false),
  repo_name: z.string().optional(),
  remote_url: z.string().optional(),
  branch: z.string().optional(),
  worktree: z.string().optional(),
});

export async function POST(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

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

  const parseResult = StartSessionSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const input = parseResult.data;

  try {
    // Get or create device
    const device = await getOrCreateDevice(
      db,
      user.id,
      input.hostname,
      input.is_remote,
      input.device_name
    );

    // Get or create repo if provided
    let repoId: string | null = null;
    if (input.repo_name) {
      const repo = await getOrCreateRepo(db, team.id, input.remote_url ?? null, input.repo_name);
      repoId = repo.id;
    }

    // Create session
    const sessionId = input.session_id ?? generateId();
    const session = await createSession(db, {
      id: sessionId,
      user_id: user.id,
      device_id: device.id,
      repo_id: repoId,
      branch: input.branch ?? null,
      worktree: input.worktree ?? null,
    });

    return successResponse({
      session_id: session.id,
      device_id: device.id,
      repo_id: repoId,
    }, 201);
  } catch (error) {
    console.error('Failed to start session:', error);
    return errorResponse('Failed to start session', 500);
  }
}
