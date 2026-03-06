/**
 * GET /api/overlaps - List detected overlaps
 *
 * Query params:
 * - repoName: Filter by repo (optional)
 * - limit: Max results (default 50)
 * - days: Time range in days (default 7)
 *
 * Auth: Web session
 */

import type { APIContext } from 'astro';
import { authenticateWebSession, errorResponse, successResponse } from '@lib/auth/middleware';
import { getOverlaps } from '@lib/db/queries';

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Require web session auth
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Parse query params
  const url = new URL(context.request.url);
  const repoName = url.searchParams.get('repoName') ?? undefined;
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const daysParam = url.searchParams.get('days');
  const days = daysParam != null ? parseInt(daysParam, 10) : 7;

  const overlaps = await getOverlaps(db, { repoName, limit, days: days > 0 ? days : undefined });

  return successResponse({ overlaps });
}
