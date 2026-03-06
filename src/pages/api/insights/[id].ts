/**
 * GET /api/insights/:id - Get a specific insight by ID
 *
 * Auth: Web session
 */

import type { APIContext } from 'astro';
import { authenticateWebSession, errorResponse, successResponse } from '@lib/auth/middleware';
import { getInsightById } from '@lib/db/queries';

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const id = context.params.id;
    if (!id) {
      return errorResponse('Missing insight ID', 400);
    }

    const insight = await getInsightById(db, id);
    if (!insight) {
      return errorResponse('Insight not found', 404);
    }

    // Users can only see their own insights or team insights
    if (insight.scope === 'user' && insight.user_id !== authResult.context.member.user_id) {
      return errorResponse('Access denied', 403);
    }

    return successResponse(insight);
  } catch (error) {
    console.error('Insight fetch error:', error);
    return errorResponse('Failed to fetch insight', 500);
  }
}
