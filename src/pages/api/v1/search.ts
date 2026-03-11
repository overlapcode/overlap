/**
 * GET /api/v1/search
 *
 * Full-text search across session activities (prompts, agent responses, activity blocks).
 * Uses FTS5 for efficient tokenized search with BM25 ranking.
 *
 * Query params:
 * - q: Search query (required, min 2 chars)
 * - limit: Max results (default 20, max 50)
 * - offset: Pagination offset
 * - repo: Filter by repo_name (optional)
 * - user: Filter by user_id (optional)
 *
 * Auth: Web session or tracer token
 */

import type { APIContext } from 'astro';
import { authenticateAny, errorResponse, successResponse } from '@lib/auth/middleware';

type SearchHit = {
  session_id: string;
  user_id: string;
  repo_name: string;
  source_type: string;
  source_id: string;
  timestamp: string;
  snippet: string;
  rank: number;
};

type SearchResult = {
  session_id: string;
  session: {
    user_name: string;
    repo_name: string;
    branch: string | null;
    started_at: string;
    status: string;
  };
  matches: Array<{
    source_type: string;
    source_id: string;
    snippet: string;
    timestamp: string;
    rank: number;
  }>;
};

/**
 * HTML-escape a string to prevent XSS, then restore <mark> tags from FTS5 snippet().
 */
function sanitizeSnippet(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    .replace(/&lt;mark&gt;/g, '<mark>')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Authenticate
  const authResult = await authenticateAny(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const url = new URL(context.request.url);
  const query = url.searchParams.get('q')?.trim();
  const repo = url.searchParams.get('repo');
  const userId = url.searchParams.get('user');
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '20', 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 20 : rawLimit, 1), 50);
  const rawOffset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  if (!query || query.length < 2) {
    return errorResponse('Search query must be at least 2 characters', 400);
  }

  try {
    // Check if FTS5 table exists
    const ftsExists = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='search_index'`
    ).first<{ name: string }>();

    if (!ftsExists) {
      return errorResponse('Search index not yet initialized. Please reload the dashboard.', 503);
    }

    // Sanitize FTS5 query: strip ALL non-alphanumeric/space chars to prevent
    // FTS5 syntax injection (AND, OR, NOT, NEAR, *, ^, :, etc.)
    const ftsQuery = query
      .replace(/[^\w\s]/g, ' ')       // strip ALL special chars
      .split(/\s+/)                   // split on whitespace
      .filter(t => t.length > 0)
      .map(t => `"${t}"`)            // quote each term for exact token match
      .join(' ');                      // implicit AND

    if (!ftsQuery) {
      return errorResponse('Invalid search query', 400);
    }

    // Build FTS5 search query with optional filters
    let sql = `
      SELECT
        session_id,
        user_id,
        repo_name,
        source_type,
        source_id,
        timestamp,
        snippet(search_index, 6, '<mark>', '</mark>', '…', 48) as snippet,
        rank
      FROM search_index
      WHERE content MATCH ?
    `;
    const binds: unknown[] = [ftsQuery];

    if (repo) {
      sql += ` AND repo_name = ?`;
      binds.push(repo);
    }
    if (userId) {
      sql += ` AND user_id = ?`;
      binds.push(userId);
    }

    sql += ` ORDER BY rank LIMIT ? OFFSET ?`;
    binds.push(limit, offset);

    const hits = await db.prepare(sql).bind(...binds).all<SearchHit>();

    if (hits.results.length === 0) {
      return successResponse({ results: [], count: 0, query, hasMore: false });
    }

    // Group hits by session
    const sessionGroups = new Map<string, SearchHit[]>();
    for (const hit of hits.results) {
      const group = sessionGroups.get(hit.session_id) ?? [];
      group.push(hit);
      sessionGroups.set(hit.session_id, group);
    }

    // Fetch session metadata for all matched sessions
    const sessionIds = [...sessionGroups.keys()];
    const sessionPlaceholders = sessionIds.map(() => '?').join(',');
    const sessionMeta = await db.prepare(`
      SELECT s.id, s.repo_name, s.git_branch, s.started_at, s.status, m.display_name
      FROM sessions s
      LEFT JOIN members m ON s.user_id = m.user_id
      WHERE s.id IN (${sessionPlaceholders})
    `).bind(...sessionIds).all<{
      id: string;
      repo_name: string;
      git_branch: string | null;
      started_at: string;
      status: string;
      display_name: string | null;
    }>();

    const sessionMap = new Map(sessionMeta.results.map(s => [s.id, s]));

    // Build results — context is loaded lazily via "Show context" in the UI
    const results: SearchResult[] = [];

    for (const [sessionId, groupHits] of sessionGroups) {
      const meta = sessionMap.get(sessionId);
      if (!meta) continue;

      results.push({
        session_id: sessionId,
        session: {
          user_name: meta.display_name ?? 'Unknown',
          repo_name: meta.repo_name,
          branch: meta.git_branch,
          started_at: meta.started_at,
          status: meta.status,
        },
        matches: groupHits.map(hit => ({
          source_type: hit.source_type,
          source_id: hit.source_id,
          snippet: sanitizeSnippet(hit.snippet),
          timestamp: hit.timestamp,
          rank: hit.rank,
        })),
      });
    }

    return successResponse({
      results,
      count: hits.results.length,
      query,
      hasMore: hits.results.length === limit,
    });
  } catch (error) {
    console.error('Search error:', error);
    return errorResponse('Search failed', 500);
  }
}
