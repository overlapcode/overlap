/**
 * POST /api/cron/stale-sessions - Mark stale sessions
 *
 * This endpoint is called by the cron trigger to mark sessions as stale
 * that haven't had activity within the configured timeout.
 *
 * Can also be called manually by admins for immediate cleanup.
 *
 * Auth: None required (internal cron endpoint) or web session for manual
 *
 * Note: In production, you may want to secure this with a secret header
 * that matches a cron secret configured in your environment.
 */

import type { APIContext } from 'astro';
import { authenticateWebSession, successResponse } from '@lib/auth/middleware';
import { markStaleSessions, deleteExpiredWebSessions } from '@lib/db/queries';

export async function POST(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Optional: Check for cron secret or admin auth
  const cronSecret = context.locals.runtime.env.CRON_SECRET;
  const requestSecret = context.request.headers.get('X-Cron-Secret');

  // If cron secret is configured, verify it
  if (cronSecret && requestSecret !== cronSecret) {
    // Fall back to admin auth
    const authResult = await authenticateWebSession(context.request, db);
    if (!authResult.success) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  // Mark stale sessions
  const staleSessions = await markStaleSessions(db);

  // Clean up expired web sessions
  await deleteExpiredWebSessions(db);

  return successResponse({
    stale_sessions_marked: staleSessions,
    cleanup_completed: true,
    timestamp: new Date().toISOString(),
  });
}

// Also support GET for easy browser testing during development
export async function GET(context: APIContext) {
  return POST(context);
}
