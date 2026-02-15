/**
 * POST /api/v1/auth/login-link
 *
 * Generate a one-click login URL for the dashboard.
 * Used by `overlap login` CLI command.
 * Authenticates via Bearer token (user_token).
 */

import type { APIContext } from 'astro';
import { authenticateTracer, errorResponse, successResponse, hashToken } from '@lib/auth/middleware';
import { createWebSession } from '@lib/db/queries';

export async function POST(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate using Bearer token
  const authResult = await authenticateTracer(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const { member } = authResult.context;

    // Create web session
    const sessionId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    const sessionTokenHash = await hashToken(sessionToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await createWebSession(db, sessionId, sessionTokenHash, expiresAt.toISOString(), member.user_id);

    // Build login URL
    const origin = new URL(request.url).origin;
    const loginUrl = `${origin}/login?token=${sessionToken}`;

    return successResponse({ login_url: loginUrl });
  } catch (error) {
    console.error('Login link error:', error);
    return errorResponse('Failed to create login link', 500);
  }
}
