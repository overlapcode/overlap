/**
 * GET /api/v1/users/me/timeline
 *
 * Returns all sessions (active, stale, ended) for the history view.
 * Auth: Web session
 */

import type { APIContext } from 'astro';
import { authenticateWebSession, errorResponse, successResponse } from '@lib/auth/middleware';
import { getSessions } from '@lib/db/queries';
import type { SessionWithMember } from '@lib/db/types';

function formatSession(session: SessionWithMember) {
  // Build activities array from summary
  const activities = [];
  if (session.generated_summary || session.result_summary) {
    activities.push({
      id: `${session.id}-summary`,
      files: [],
      semantic_scope: null,
      summary: session.generated_summary || session.result_summary,
      created_at: session.started_at,
    });
  }

  return {
    id: session.id,
    device: {
      name: session.hostname || session.device_name || 'local',
      is_remote: !!session.is_remote,
    },
    repo: session.repo
      ? { id: session.repo.id, name: session.repo.name }
      : session.repo_name
        ? { id: 'unknown', name: session.repo_name }
        : null,
    branch: session.git_branch,
    status: session.status as 'active' | 'stale' | 'ended',
    started_at: session.started_at,
    last_activity_at: session.ended_at || session.started_at,
    ended_at: session.ended_at,
    activities,
  };
}

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const url = new URL(context.request.url);
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');

    const rawLimit = limitParam ? parseInt(limitParam, 10) : 20;
    const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);
    const rawOffset = offsetParam ? parseInt(offsetParam, 10) : 0;
    const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    // Get only the authenticated user's sessions (active, stale, ended)
    const result = await getSessions(db, {
      limit,
      offset,
      userId: authResult.context.member.user_id,
      status: 'all',
    });

    return successResponse({
      sessions: result.sessions.map(formatSession),
      hasMore: result.hasMore,
    });
  } catch (error) {
    console.error('Timeline error:', error);
    return errorResponse('Failed to fetch timeline', 500);
  }
}
