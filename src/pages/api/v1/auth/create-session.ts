import type { APIContext } from 'astro';
import { z } from 'zod';
import { errorResponse, successResponse, hashToken } from '@lib/auth/middleware';
import { getTeamConfig, createWebSession } from '@lib/db/queries';
import { verifyPassword } from '@lib/utils/crypto';

const CreateSessionSchema = z.object({
  password: z.string(),
});

/**
 * Create a web session for dashboard access.
 * In v2, dashboard access is via team password authentication.
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

  const { password } = parseResult.data;

  try {
    // Get team config
    const config = await getTeamConfig(db);
    if (!config) {
      return errorResponse('Team not configured', 404);
    }

    // Verify password
    const isValid = await verifyPassword(password, config.password_hash);
    if (!isValid) {
      return errorResponse('Invalid password', 401);
    }

    // Create web session
    const sessionId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();

    // Hash the token for storage
    const tokenHash = await hashToken(sessionToken);

    // Session expires in 30 days
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await createWebSession(db, sessionId, tokenHash, expiresAt.toISOString());

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
