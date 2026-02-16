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
import type { Prompt, FileOperation, AgentResponse } from '@lib/db/types';

type FormattedAgentResponse = {
  text: string;
  type: 'text' | 'thinking';
};

type FormattedActivity = {
  id: string;
  session_id: string;
  semantic_scope: string | null;
  summary: string | null;
  agent_responses: FormattedAgentResponse[];
  files: string[];
  created_at: string;
};

/**
 * Build activity items from prompts + file operations + agent responses.
 * Each prompt becomes an activity. File operations and agent responses are
 * assigned to the prompt that precedes them in time.
 */
function buildActivities(
  sessionId: string,
  prompts: Prompt[],
  fileOps: FileOperation[],
  agentResponses: AgentResponse[]
): FormattedActivity[] {
  if (prompts.length === 0 && fileOps.length === 0 && agentResponses.length === 0) {
    return [];
  }

  // If no prompts, group file operations into time-based buckets (5 min windows)
  if (prompts.length === 0) {
    const BUCKET_MS = 5 * 60 * 1000;
    const allEvents = [
      ...fileOps.map((fo) => ({ type: 'file' as const, ts: fo.timestamp, data: fo })),
      ...agentResponses.map((ar) => ({ type: 'response' as const, ts: ar.timestamp, data: ar })),
    ].sort((a, b) => a.ts.localeCompare(b.ts));

    if (allEvents.length === 0) return [];

    const buckets: typeof allEvents[] = [];
    let currentBucket: typeof allEvents = [allEvents[0]];
    let bucketStart = new Date(allEvents[0].ts).getTime();

    for (let i = 1; i < allEvents.length; i++) {
      const eventTime = new Date(allEvents[i].ts).getTime();
      if (eventTime - bucketStart > BUCKET_MS) {
        buckets.push(currentBucket);
        currentBucket = [allEvents[i]];
        bucketStart = eventTime;
      } else {
        currentBucket.push(allEvents[i]);
      }
    }
    buckets.push(currentBucket);

    return buckets.map((bucket, idx) => {
      const files = bucket.filter((e) => e.type === 'file');
      const responses = bucket.filter((e) => e.type === 'response');
      const uniqueFiles = [...new Set(files.map((f) => (f.data as FileOperation).file_path).filter(Boolean))] as string[];
      const formattedResponses = responses
        .filter((r) => (r.data as AgentResponse).response_text)
        .map((r) => ({
          text: truncateText((r.data as AgentResponse).response_text!, 500),
          type: (r.data as AgentResponse).response_type as 'text' | 'thinking',
        }));

      return {
        id: `${sessionId}-bucket-${idx}`,
        session_id: sessionId,
        semantic_scope: null,
        summary: `${files.length} file operation${files.length !== 1 ? 's' : ''}`,
        agent_responses: formattedResponses,
        files: uniqueFiles,
        created_at: bucket[0].ts,
      };
    });
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

    // Find agent responses between this prompt and the next
    const associatedResponses = agentResponses.filter((ar) => {
      const arTime = ar.timestamp;
      const afterCurrent = arTime >= prompt.timestamp;
      const beforeNext = !nextPrompt || arTime < nextPrompt.timestamp;
      return afterCurrent && beforeNext;
    });

    const uniqueFiles = [
      ...new Set(associatedOps.map((fo) => fo.file_path).filter(Boolean)),
    ] as string[];

    const responses = associatedResponses
      .filter((ar) => ar.response_text)
      .map((ar) => ({
        text: truncateText(ar.response_text!, 500),
        type: ar.response_type as 'text' | 'thinking',
      }));

    activities.push({
      id: String(prompt.id),
      session_id: sessionId,
      semantic_scope: null,
      summary: prompt.prompt_text
        ? prompt.prompt_text.length > 300
          ? prompt.prompt_text.slice(0, 300) + '...'
          : prompt.prompt_text
        : null,
      agent_responses: responses,
      files: uniqueFiles,
      created_at: prompt.timestamp,
    });
  }

  return activities;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
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

    // Build activities from prompts + file operations + agent responses (newest first)
    const allActivities = buildActivities(sessionId, detail.prompts, detail.file_operations, detail.agent_responses).reverse();

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
            remote_url: detail.repo.remote_url ?? null,
          }
        : {
            id: 'unknown',
            name: detail.repo_name,
            remote_url: null,
          },
      branch: detail.git_branch,
      worktree: detail.cwd || null,
      agent_type: detail.agent_type,
      status: detail.status,
      started_at: detail.started_at,
      last_activity_at: [
        detail.file_operations.at(-1)?.timestamp,
        detail.agent_responses.at(-1)?.timestamp,
        detail.prompts.at(-1)?.timestamp,
        detail.started_at,
      ].filter(Boolean).sort().pop() ?? detail.started_at,
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
