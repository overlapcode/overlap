/**
 * GET /api/v1/sessions/:id/activities
 *
 * Returns session info + activity timeline (prompts with associated file operations).
 *
 * Query params:
 * - limit: Max results (default 20)
 * - offset: Pagination offset
 *
 * Auth: Web session or tracer token
 */

import type { APIContext } from 'astro';
import { authenticateAny, errorResponse, successResponse } from '@lib/auth/middleware';
import { getSessionDetail } from '@lib/db/queries';
import type { Prompt, FileOperation } from '@lib/db/types';

type FormattedActivity = {
  id: string;
  session_id: string;
  semantic_scope: string | null;
  summary: string | null;
  files: string[];
  created_at: string;
};

/**
 * Build activity items from prompts + file operations.
 * Each prompt becomes an activity. File operations are assigned
 * to the prompt that precedes them in time.
 */
function buildActivities(
  sessionId: string,
  prompts: Prompt[],
  fileOps: FileOperation[]
): FormattedActivity[] {
  if (prompts.length === 0 && fileOps.length === 0) {
    return [];
  }

  // If no prompts, group file operations into a single activity
  if (prompts.length === 0) {
    const uniqueFiles = [...new Set(fileOps.map((fo) => fo.file_path).filter(Boolean))] as string[];
    return [
      {
        id: `${sessionId}-fileops`,
        session_id: sessionId,
        semantic_scope: null,
        summary: `${fileOps.length} file operation${fileOps.length !== 1 ? 's' : ''}`,
        files: uniqueFiles,
        created_at: fileOps[0]?.timestamp ?? new Date().toISOString(),
      },
    ];
  }

  const activities: FormattedActivity[] = [];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const nextPrompt = prompts[i + 1];

    // Find file ops between this prompt and the next
    const associatedOps = fileOps.filter((fo) => {
      const opTime = fo.timestamp;
      const afterCurrent = opTime >= prompt.timestamp;
      const beforeNext = !nextPrompt || opTime < nextPrompt.timestamp;
      return afterCurrent && beforeNext;
    });

    const uniqueFiles = [
      ...new Set(associatedOps.map((fo) => fo.file_path).filter(Boolean)),
    ] as string[];

    activities.push({
      id: String(prompt.id),
      session_id: sessionId,
      semantic_scope: null,
      summary: prompt.prompt_text
        ? prompt.prompt_text.length > 300
          ? prompt.prompt_text.slice(0, 300) + '...'
          : prompt.prompt_text
        : null,
      files: uniqueFiles,
      created_at: prompt.timestamp,
    });
  }

  return activities;
}

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;
  const sessionId = context.params.id;

  if (!sessionId) {
    return errorResponse('Session ID required', 400);
  }

  // Authenticate
  const authResult = await authenticateAny(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const detail = await getSessionDetail(db, sessionId);
    if (!detail) {
      return errorResponse('Session not found', 404);
    }

    // Build activities from prompts + file operations
    const allActivities = buildActivities(sessionId, detail.prompts, detail.file_operations);

    // Parse pagination
    const url = new URL(context.request.url);
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const rawLimit = limitParam ? parseInt(limitParam, 10) : 20;
    const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);
    const rawOffset = offsetParam ? parseInt(offsetParam, 10) : 0;
    const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    const paginated = allActivities.slice(offset, offset + limit);
    const total = allActivities.length;

    // Format session for the UI
    const session = {
      id: detail.id,
      user: {
        id: detail.member.user_id,
        name: detail.member.display_name,
      },
      device: {
        id: 'default',
        name: detail.device_name || 'local',
        is_remote: detail.is_remote,
      },
      repo: detail.repo
        ? {
            id: detail.repo.id,
            name: detail.repo.name,
            remote_url: null,
          }
        : {
            id: 'unknown',
            name: detail.repo_name,
            remote_url: null,
          },
      branch: detail.git_branch,
      worktree: null,
      status: detail.status,
      started_at: detail.started_at,
      last_activity_at:
        detail.file_operations.length > 0
          ? detail.file_operations[detail.file_operations.length - 1].timestamp
          : detail.started_at,
      ended_at: detail.ended_at,
    };

    return successResponse({
      session,
      activities: paginated,
      total,
      hasMore: offset + paginated.length < total,
    });
  } catch (error) {
    console.error('Session activities error:', error);
    return errorResponse('Failed to fetch session activities', 500);
  }
}
