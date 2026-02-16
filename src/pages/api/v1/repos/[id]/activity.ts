/**
 * GET /api/v1/repos/:id/activity
 *
 * Returns sessions for a specific repo with filtering and pagination.
 * Auth: Web session
 */

import type { APIContext } from 'astro';
import { authenticateWebSession, errorResponse, successResponse } from '@lib/auth/middleware';
import { getRepoById, getSessions, getAllMembers } from '@lib/db/queries';
import type { SessionWithMember } from '@lib/db/types';

function formatSession(session: SessionWithMember) {
  // Get distinct files from file_operations (already in session data via join if needed)
  return {
    id: session.id,
    user: {
      id: session.member.user_id,
      name: session.member.display_name,
    },
    device: {
      id: session.hostname || 'local',
      name: session.hostname || session.device_name || 'local',
      is_remote: !!session.is_remote,
    },
    repo: session.repo
      ? { id: session.repo.id, name: session.repo.name, remote_url: session.repo.remote_url ?? null }
      : session.repo_name
        ? { id: 'unknown', name: session.repo_name, remote_url: null }
        : null,
    branch: session.git_branch,
    worktree: session.cwd || null,
    agent_type: session.agent_type,
    status: session.status as 'active' | 'stale' | 'ended',
    started_at: session.started_at,
    last_activity_at: session.ended_at || session.started_at,
    activity: {
      semantic_scope: null,
      summary: session.generated_summary || session.result_summary || null,
      files: [] as string[],
    },
  };
}

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const repoId = context.params.id;
    if (!repoId) {
      return errorResponse('Missing repo ID', 400);
    }

    // Verify repo exists
    const repo = await getRepoById(db, repoId);
    if (!repo) {
      return errorResponse('Repo not found', 404);
    }

    const url = new URL(context.request.url);
    const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10);
    const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);
    const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
    const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    const includeStale = url.searchParams.get('includeStale') !== 'false';
    const userId = url.searchParams.get('userId') || undefined;
    const branch = url.searchParams.get('branch') || undefined;
    const startDate = url.searchParams.get('startDate') || undefined;
    const endDate = url.searchParams.get('endDate') || undefined;

    // Determine status filter
    let status: 'active' | 'stale' | 'ended' | 'active_or_stale' | 'all' = 'all';
    if (!includeStale) {
      status = 'active';
    }

    const result = await getSessions(db, {
      limit,
      offset,
      repoName: repo.name,
      userId,
      status,
      startDate,
      endDate,
    });

    // Filter by branch if specified (getSessions doesn't support branch filter)
    let sessions = result.sessions;
    if (branch) {
      sessions = sessions.filter((s) => s.git_branch === branch);
    }

    // Get filter metadata
    const members = await getAllMembers(db);
    const branches = [...new Set(result.sessions.map((s) => s.git_branch).filter(Boolean))] as string[];
    const users = members.map((m) => ({ id: m.user_id, name: m.display_name }));

    // Add file lists to sessions
    const formattedSessions = [];
    for (const session of sessions) {
      const formatted = formatSession(session);

      // Get distinct files for this session
      const filesResult = await db
        .prepare(
          `SELECT DISTINCT file_path FROM file_operations WHERE session_id = ? AND file_path IS NOT NULL ORDER BY timestamp DESC LIMIT 20`
        )
        .bind(session.id)
        .all<{ file_path: string }>();

      formatted.activity.files = filesResult.results.map((f) => f.file_path);
      formattedSessions.push(formatted);
    }

    return successResponse({
      sessions: formattedSessions,
      hasMore: result.hasMore,
      total: result.total,
      filters: { branches, users },
    });
  } catch (error) {
    console.error('Repo activity error:', error);
    return errorResponse('Failed to fetch repo activity', 500);
  }
}
