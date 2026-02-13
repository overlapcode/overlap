/**
 * GET /api/files/:path - File activity history
 *
 * Query params:
 * - repoName: Required - the repo containing this file
 * - limit: Max results (default 50)
 * - days: Time range in days (default 7)
 *
 * Auth: Web session
 */

import type { APIContext } from 'astro';
import { authenticateWebSession, errorResponse, successResponse } from '@lib/auth/middleware';
import { getFileActivity } from '@lib/db/queries';

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Require web session auth
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Get file path from params
  const { path } = context.params;
  if (!path) {
    return errorResponse('File path required', 400);
  }

  // Parse query params
  const url = new URL(context.request.url);
  const repoName = url.searchParams.get('repoName');
  if (!repoName) {
    return errorResponse('repoName query param required', 400);
  }

  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const days = parseInt(url.searchParams.get('days') ?? '7', 10);

  const activity = await getFileActivity(db, path, repoName, { limit, days });

  return successResponse({
    file_path: path,
    repo_name: repoName,
    ...activity,
  });
}
