import { authenticateRequest, errorResponse, successResponse } from '@lib/auth/middleware';
import { generateId, generateShortToken } from '@lib/utils/id';
import { addDays } from '@lib/utils/time';

type Env = {
  DB: D1Database;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Authenticate
  const authResult = await authenticateRequest(request, env.DB);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }
  const { user } = authResult.context;

  try {
    // Generate magic link token
    const linkId = generateId();
    const token = generateShortToken();
    const expiresAt = addDays(new Date(), 7);

    // Store in database
    await env.DB
      .prepare(
        `INSERT INTO magic_links (id, token, user_id, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(linkId, token, user.id, expiresAt.toISOString())
      .run();

    // Get the request origin to build the full URL
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    return successResponse({
      magic_link: `${baseUrl}/auth/magic?token=${token}`,
      expires_at: expiresAt.toISOString(),
      message: 'Magic link generated. It will expire in 7 days.',
    }, 201);
  } catch (error) {
    console.error('Magic link error:', error);
    return errorResponse('Failed to generate magic link', 500);
  }
};
