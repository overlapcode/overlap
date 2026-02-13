/**
 * GET /api/sessions - List sessions with filters
 *
 * Query params:
 * - userId: Filter by user (optional)
 * - repoName: Filter by repo (optional)
 * - status: 'active' | 'stale' | 'ended' | 'active_or_stale' (default)
 * - startDate: YYYY-MM-DD (optional)
 * - endDate: YYYY-MM-DD (optional)
 * - limit: Max results (default 20)
 * - offset: Pagination offset (default 0)
 *
 * Auth: Web session or tracer token
 */

import type { APIContext } from 'astro';
import { authenticateAny, errorResponse, successResponse } from '@lib/auth/middleware';
import { getSessions } from '@lib/db/queries';

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Require auth (web or tracer)
  const authResult = await authenticateAny(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Parse query params
  const url = new URL(context.request.url);
  const userId = url.searchParams.get('userId') ?? undefined;
  const repoName = url.searchParams.get('repoName') ?? undefined;
  const status = url.searchParams.get('status') as 'active' | 'stale' | 'ended' | 'active_or_stale' | null;
  const startDate = url.searchParams.get('startDate') ?? undefined;
  const endDate = url.searchParams.get('endDate') ?? undefined;
  const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  const result = await getSessions(db, {
    userId,
    repoName,
    status: status ?? 'active_or_stale',
    startDate,
    endDate,
    limit,
    offset,
  });

  return successResponse(result);
}
