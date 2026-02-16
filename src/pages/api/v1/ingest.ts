/**
 * POST /api/v1/ingest
 *
 * Receives batched events from the tracer binary.
 * Processes session_start, session_end, file_op, and prompt events.
 *
 * Auth: Bearer {user_token}
 */

import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateTracer, errorResponse, successResponse } from '@lib/auth/middleware';
import {
  getSessionById,
  createSession,
  updateSessionOnEnd,
  createFileOperation,
  createPrompt,
  createAgentResponse,
  incrementSessionEventCount,
  updateMemberLastActive,
  detectFileOverlaps,
  reactivateSession,
} from '@lib/db/queries';
import type { IngestEvent } from '@lib/db/types';
import { maybeGenerateSummary, generateSessionSummary } from '@lib/summary';

// Zod schema for validation
const IngestEventSchema = z.object({
  session_id: z.string().min(1),
  timestamp: z.string().min(1),
  event_type: z.enum(['session_start', 'session_end', 'file_op', 'prompt', 'agent_response']),
  user_id: z.string().min(1),
  repo_name: z.string().min(1),
  agent_type: z.string().min(1).default('claude_code'),

  // session_start only
  cwd: z.string().optional(),
  git_branch: z.string().optional(),
  model: z.string().optional(),
  agent_version: z.string().optional(),
  hostname: z.string().optional(),
  device_name: z.string().optional(),
  is_remote: z.boolean().optional(),

  // file_op only
  tool_name: z.string().optional(),
  file_path: z.string().optional(),
  operation: z.string().optional(),
  start_line: z.number().int().optional(),
  end_line: z.number().int().optional(),
  function_name: z.string().optional(),
  bash_command: z.string().optional(),

  // prompt only
  prompt_text: z.string().optional(),
  turn_number: z.number().optional(),

  // agent_response only
  response_text: z.string().optional(),
  response_type: z.enum(['text', 'thinking']).optional(),

  // session_end only
  total_cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
  num_turns: z.number().optional(),
  total_input_tokens: z.number().optional(),
  total_output_tokens: z.number().optional(),
  cache_creation_tokens: z.number().optional(),
  cache_read_tokens: z.number().optional(),
  result_summary: z.string().optional(),
  files_touched: z.array(z.string()).optional(),
});

const IngestPayloadSchema = z.object({
  events: z.array(IngestEventSchema).min(1).max(100),
});

export async function POST(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Authenticate tracer
  const authResult = await authenticateTracer(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const { member } = authResult.context;

  // Parse and validate request body
  let payload: z.infer<typeof IngestPayloadSchema>;
  try {
    const body = await context.request.json();
    payload = IngestPayloadSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
    }
    return errorResponse('Invalid JSON payload', 400);
  }

  // Process events
  const results = {
    processed: 0,
    errors: [] as string[],
    sessions_created: 0,
    sessions_ended: 0,
    file_ops_created: 0,
    prompts_created: 0,
    agent_responses_created: 0,
  };

  // Track repos that had file operations for overlap detection
  const reposWithFileOps = new Set<string>();
  // Track sessions that need summary generation
  const sessionsForSummary = new Set<string>();
  // Track sessions that ended (need final summary)
  const endedSessions = new Set<string>();

  // Get encryption key for summary generation
  const encryptionKey = context.locals.runtime.env.TEAM_ENCRYPTION_KEY;

  for (const event of payload.events) {
    try {
      // Verify the event user_id matches the authenticated member
      // (tracer sends user_id, we verify it matches the token)
      if (event.user_id !== member.user_id) {
        results.errors.push(`Event user_id ${event.user_id} doesn't match authenticated user ${member.user_id}`);
        continue;
      }

      await processEvent(db, event, results, reposWithFileOps, sessionsForSummary, endedSessions);
      results.processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.errors.push(`Error processing event ${event.event_type} for session ${event.session_id}: ${message}`);
    }
  }

  // Update member's last active timestamp
  await updateMemberLastActive(db, member.user_id);

  // Detect overlaps for repos that had file operations
  // Use waitUntil to not block the response
  for (const repoName of reposWithFileOps) {
    context.locals.runtime.ctx.waitUntil(detectFileOverlaps(db, repoName));
  }

  // Trigger rolling summary generation for sessions with enough events
  for (const sessionId of sessionsForSummary) {
    context.locals.runtime.ctx.waitUntil(maybeGenerateSummary(db, sessionId, encryptionKey));
  }

  // Generate final summaries for ended sessions
  for (const sessionId of endedSessions) {
    context.locals.runtime.ctx.waitUntil(generateSessionSummary(db, sessionId, encryptionKey));
  }

  return successResponse(results);
}

async function processEvent(
  db: D1Database,
  event: IngestEvent,
  results: {
    sessions_created: number;
    sessions_ended: number;
    file_ops_created: number;
    prompts_created: number;
    agent_responses_created: number;
  },
  reposWithFileOps: Set<string>,
  sessionsForSummary: Set<string>,
  endedSessions: Set<string>
): Promise<void> {
  switch (event.event_type) {
    case 'session_start': {
      // Check if session already exists (idempotency)
      const existing = await getSessionById(db, event.session_id);
      if (existing) {
        // Session exists, reactivate if stale
        if (existing.status === 'stale' || existing.status === 'ended') {
          await reactivateSession(db, event.session_id);
        }
        // Backfill any null fields the original session_start missed
        const updates: string[] = [];
        const values: unknown[] = [];
        if (!existing.git_branch && event.git_branch) {
          updates.push('git_branch = ?');
          values.push(event.git_branch);
        }
        if (!existing.model && event.model) {
          updates.push('model = ?');
          values.push(event.model);
        }
        if (updates.length > 0) {
          values.push(event.session_id);
          await db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
        }
        return;
      }

      await createSession(db, event);
      results.sessions_created++;
      break;
    }

    case 'session_end': {
      // Ensure session exists first
      const session = await getSessionById(db, event.session_id);
      if (!session) {
        // Create the session if it doesn't exist (late join scenario)
        await createSession(db, event);
        results.sessions_created++;
      }

      await updateSessionOnEnd(db, event);
      results.sessions_ended++;

      // Track for final summary generation
      endedSessions.add(event.session_id);
      break;
    }

    case 'file_op': {
      // Ensure session exists
      let session = await getSessionById(db, event.session_id);
      if (!session) {
        // Create session on first file_op (lazy session creation)
        await createSession(db, event);
        results.sessions_created++;
        session = await getSessionById(db, event.session_id);
      }

      // Reactivate if session was stale
      if (session && (session.status === 'stale' || session.status === 'ended')) {
        await reactivateSession(db, event.session_id);
      }

      await createFileOperation(db, event);
      results.file_ops_created++;

      // Track for overlap detection
      reposWithFileOps.add(event.repo_name);

      // Increment event count for rolling summaries
      await incrementSessionEventCount(db, event.session_id);

      // Track for summary generation
      sessionsForSummary.add(event.session_id);
      break;
    }

    case 'prompt': {
      // Ensure session exists
      let session = await getSessionById(db, event.session_id);
      if (!session) {
        // Create session on first prompt (lazy session creation)
        await createSession(db, event);
        results.sessions_created++;
        session = await getSessionById(db, event.session_id);
      }

      // Reactivate if session was stale
      if (session && (session.status === 'stale' || session.status === 'ended')) {
        await reactivateSession(db, event.session_id);
      }

      await createPrompt(db, event);
      results.prompts_created++;

      // Increment event count for rolling summaries
      await incrementSessionEventCount(db, event.session_id);

      // Track for summary generation
      sessionsForSummary.add(event.session_id);
      break;
    }

    case 'agent_response': {
      // Ensure session exists
      let session = await getSessionById(db, event.session_id);
      if (!session) {
        await createSession(db, event);
        results.sessions_created++;
        session = await getSessionById(db, event.session_id);
      }

      // Reactivate if session was stale
      if (session && (session.status === 'stale' || session.status === 'ended')) {
        await reactivateSession(db, event.session_id);
      }

      await createAgentResponse(db, event);
      results.agent_responses_created++;

      // Increment event count for rolling summaries
      await incrementSessionEventCount(db, event.session_id);

      // Track for summary generation
      sessionsForSummary.add(event.session_id);
      break;
    }

    default:
      throw new Error(`Unknown event type: ${(event as IngestEvent).event_type}`);
  }
}

// Type declaration for D1Database (imported from workers-types)
type D1Database = import('@cloudflare/workers-types').D1Database;
