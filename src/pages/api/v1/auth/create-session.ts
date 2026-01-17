import type { APIContext } from 'astro';
import { z } from 'zod';
import { errorResponse, successResponse } from '@lib/auth/middleware';
import { getUserByToken, getTeam } from '@lib/db/queries';

const CreateSessionSchema = z.object({
  user_id: z.string(),
  user_token: z.string(),
  team_token: z.string(),
});

/**
 * Create a web session for dashboard access.
 * Called after setup or join to authenticate the user for the web dashboard.
 */
export async function POST(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parseResult = CreateSessionSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const { user_token, team_token } = parseResult.data;

  try {
    // Validate team token
    const team = await getTeam(db);
    if (!team || team.team_token !== team_token) {
      return errorResponse('Invalid team token', 401);
    }

    // Validate user token
    const user = await getUserByToken(db, user_token);
    if (!user) {
      return errorResponse('Invalid user token', 401);
    }

    // Create web session
    const sessionId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();

    // Hash the token for storage
    const encoder = new TextEncoder();
    const data = encoder.encode(sessionToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const tokenHash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

    // Session expires in 30 days
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db
      .prepare(
        `INSERT INTO web_sessions (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(sessionId, user.id, tokenHash, expiresAt.toISOString())
      .run();

    // Return the session token in a Set-Cookie header
    const response = successResponse({ message: 'Session created' });

    // Clone and add cookie header
    const headers = new Headers(response.headers);
    headers.set(
      'Set-Cookie',
      `overlap_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expiresAt.toUTCString()}`
    );

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error('Create session error:', error);
    return errorResponse('Failed to create session', 500);
  }
}
