/**
 * GET /api/v1/search-context
 *
 * Fetch surrounding activities for a specific search match.
 * Lazy-loaded by the frontend when user clicks "Show context".
 *
 * Query params:
 * - session_id: Session ID (required)
 * - timestamp: Match timestamp to center context around (required)
 *
 * Auth: Web session or tracer token
 */

import type { APIContext } from 'astro';
import { authenticateAny, errorResponse, successResponse } from '@lib/auth/middleware';

type ContextActivity = {
  id: string;
  source_type: 'prompt' | 'response';
  content: string;
  timestamp: string;
};

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  const authResult = await authenticateAny(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const url = new URL(context.request.url);
  const sessionId = url.searchParams.get('session_id');
  const timestamp = url.searchParams.get('timestamp');

  if (!sessionId || !timestamp) {
    return errorResponse('session_id and timestamp are required', 400);
  }

  try {
    const results = await db.prepare(`
      SELECT * FROM (
        SELECT id, 'prompt' as source_type, prompt_text as content, timestamp
        FROM prompts
        WHERE session_id = ? AND prompt_text IS NOT NULL AND timestamp <= ?
        ORDER BY timestamp DESC LIMIT 3
      )
      UNION ALL
      SELECT * FROM (
        SELECT id, 'prompt' as source_type, prompt_text as content, timestamp
        FROM prompts
        WHERE session_id = ? AND prompt_text IS NOT NULL AND timestamp > ?
        ORDER BY timestamp ASC LIMIT 3
      )
      UNION ALL
      SELECT * FROM (
        SELECT id, 'response' as source_type, response_text as content, timestamp
        FROM agent_responses
        WHERE session_id = ? AND response_text IS NOT NULL AND response_type = 'text' AND timestamp <= ?
        ORDER BY timestamp DESC LIMIT 3
      )
      UNION ALL
      SELECT * FROM (
        SELECT id, 'response' as source_type, response_text as content, timestamp
        FROM agent_responses
        WHERE session_id = ? AND response_text IS NOT NULL AND response_type = 'text' AND timestamp > ?
        ORDER BY timestamp ASC LIMIT 3
      )
      ORDER BY timestamp ASC
    `).bind(
      sessionId, timestamp,
      sessionId, timestamp,
      sessionId, timestamp,
      sessionId, timestamp,
    ).all<{ id: number; source_type: 'prompt' | 'response'; content: string; timestamp: string }>();

    const activities: ContextActivity[] = results.results.map(c => ({
      id: String(c.id),
      source_type: c.source_type,
      content: c.content.length > 500 ? c.content.substring(0, 500) + '…' : c.content,
      timestamp: c.timestamp,
    }));

    return successResponse({ activities, match_timestamp: timestamp });
  } catch (error) {
    console.error('Search context error:', error);
    return errorResponse('Failed to fetch context', 500);
  }
}
