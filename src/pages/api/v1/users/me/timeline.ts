import type { APIContext } from 'astro';
import { authenticateAny, errorResponse, successResponse } from '@lib/auth/middleware';

export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }
  const { user } = authResult.context;

  // Parse query params
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const rawLimit = limitParam ? parseInt(limitParam, 10) : 20;
  const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);
  const rawOffset = offsetParam ? parseInt(offsetParam, 10) : 0;
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  try {
    // Get user's sessions with activity (fetch limit+1 for hasMore check)
    const result = await db
      .prepare(
        `SELECT
          s.*,
          d.name as device_name, d.is_remote as device_is_remote,
          r.name as repo_name,
          (
            SELECT json_group_array(json_object(
              'id', a.id,
              'files', a.files,
              'semantic_scope', a.semantic_scope,
              'summary', a.summary,
              'created_at', a.created_at
            ))
            FROM activity a
            WHERE a.session_id = s.id
            ORDER BY a.created_at DESC
            LIMIT 10
          ) as activities
        FROM sessions s
        JOIN devices d ON s.device_id = d.id
        LEFT JOIN repos r ON s.repo_id = r.id
        WHERE s.user_id = ?
        ORDER BY s.started_at DESC
        LIMIT ? OFFSET ?`
      )
      .bind(user.id, limit + 1, offset)
      .all();

    const hasMore = result.results.length > limit;
    const rows = hasMore ? result.results.slice(0, limit) : result.results;

    const sessions = rows.map((row: Record<string, unknown>) => {
      let activities: Array<{
        id: string;
        files: string;
        semantic_scope: string | null;
        summary: string | null;
        created_at: string;
      }> = [];

      try {
        const parsed = JSON.parse(row.activities as string);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id) {
          activities = parsed;
        }
      } catch {
        // Ignore parse errors
      }

      return {
        id: row.id,
        device: {
          name: row.device_name,
          is_remote: row.device_is_remote === 1,
        },
        repo: row.repo_name ? { id: row.repo_id, name: row.repo_name } : null,
        branch: row.branch,
        status: row.status,
        started_at: row.started_at,
        last_activity_at: row.last_activity_at,
        ended_at: row.ended_at,
        activities: activities.map((a) => {
          let files: string[] = [];
          try {
            const parsed = JSON.parse(a.files);
            files = Array.isArray(parsed) ? parsed : [];
          } catch {
            // Ignore malformed files JSON
          }
          return {
            id: a.id,
            files,
            semantic_scope: a.semantic_scope,
            summary: a.summary,
            created_at: a.created_at,
          };
        }),
      };
    });

    return successResponse({ sessions, hasMore });
  } catch (error) {
    console.error('Timeline error:', error);
    return errorResponse('Failed to fetch timeline', 500);
  }
}
