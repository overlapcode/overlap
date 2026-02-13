/**
 * GET /api/stats - Team analytics
 *
 * Query params:
 * - startDate: YYYY-MM-DD (optional)
 * - endDate: YYYY-MM-DD (optional)
 *
 * Auth: Web session
 */

import type { APIContext } from 'astro';
import { authenticateWebSession, errorResponse, successResponse } from '@lib/auth/middleware';
import { getTeamStats } from '@lib/db/queries';

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Require web session auth
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    // Parse query params
    const url = new URL(context.request.url);
    const startDate = url.searchParams.get('startDate') ?? undefined;
    const endDate = url.searchParams.get('endDate') ?? undefined;

    const stats = await getTeamStats(db, { startDate, endDate });

    return successResponse(stats);
  } catch (error) {
    console.error('Stats error:', error);
    return errorResponse('Failed to fetch stats', 500);
  }
}
