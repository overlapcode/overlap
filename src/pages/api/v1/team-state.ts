/**
 * GET /api/v1/team-state
 *
 * Returns active sessions with file regions for real-time coordination.
 * Polled by the tracer daemon every ~30 seconds to build local cache.
 *
 * Auth: Bearer {user_token}
 */

import type { APIContext } from 'astro';
import { authenticateTracer, errorResponse, successResponse } from '@lib/auth/middleware';
import { getActiveSessionsWithRegions } from '@lib/db/queries';

type SessionRegion = {
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  function_name: string | null;
  last_touched_at: string | null;
};

type TeamStateSession = {
  session_id: string;
  user_id: string;
  display_name: string;
  repo_name: string;
  started_at: string;
  summary: string | null;
  regions: SessionRegion[];
};

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Authenticate tracer
  const authResult = await authenticateTracer(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const rows = await getActiveSessionsWithRegions(db);

    // Group rows by session_id, nesting file regions
    const sessionsMap = new Map<string, TeamStateSession>();

    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const sessionId = r.session_id as string;

      if (!sessionsMap.has(sessionId)) {
        sessionsMap.set(sessionId, {
          session_id: sessionId,
          user_id: r.user_id as string,
          display_name: r.display_name as string,
          repo_name: r.repo_name as string,
          started_at: r.started_at as string,
          summary: (r.summary as string) || null,
          regions: [],
        });
      }

      // Add file region if present
      if (r.file_path) {
        sessionsMap.get(sessionId)!.regions.push({
          file_path: r.file_path as string,
          start_line: (r.start_line as number) || null,
          end_line: (r.end_line as number) || null,
          function_name: (r.function_name as string) || null,
          last_touched_at: (r.last_touched_at as string) || null,
        });
      }
    }

    return successResponse({
      sessions: Array.from(sessionsMap.values()),
    });
  } catch (error) {
    console.error('Team state error:', error);
    return errorResponse('Failed to get team state', 500);
  }
}
