/**
 * POST /api/v1/auth/create-session
 *
 * Create a web session for dashboard access using a user token.
 * Validates the token against members table and creates a session cookie.
 */

import type { APIContext } from 'astro';
import { z } from 'zod';
import { errorResponse, successResponse, hashToken } from '@lib/auth/middleware';
import { getMemberByTokenHash, createWebSession } from '@lib/db/queries';

const CreateSessionSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export async function POST(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parseResult = CreateSessionSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse('Token is required', 400);
  }

  const { token } = parseResult.data;

  try {
    // Hash token and look up member
    const tokenHash = await hashToken(token);
    const member = await getMemberByTokenHash(db, tokenHash);
    if (!member) {
      return errorResponse('Invalid token', 401);
    }

    // Create web session tied to this member
    const sessionId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    const sessionTokenHash = await hashToken(sessionToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await createWebSession(db, sessionId, sessionTokenHash, expiresAt.toISOString(), member.user_id);

    // Set cookie
    const response = successResponse({ message: 'Session created' });
    const headers = new Headers(response.headers);
    headers.set(
      'Set-Cookie',
      `overlap_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expiresAt.toUTCString()}`
    );

    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error('Create session error:', error);
    return errorResponse('Failed to create session', 500);
  }
}
