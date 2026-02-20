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
  getRepoByName,
  getTeamConfig,
  updateMemberLastActive,
  detectFileOverlaps,
} from '@lib/db/queries';
import type { IngestEvent, Session, Repo } from '@lib/db/types';
import { maybeGenerateSummary, generateSessionSummary } from '@lib/summary';
import { classifyActivity } from '@lib/activity';

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
  git_remote_url: z.string().optional(),

  // file_op only
  tool_name: z.string().optional(),
  file_path: z.string().optional(),
  operation: z.string().optional(),
  start_line: z.number().int().optional(),
  end_line: z.number().int().optional(),
  function_name: z.string().optional(),
  bash_command: z.string().optional(),
  old_string: z.string().optional(),
  new_string: z.string().optional(),

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

  // Fetch team config for stale timeout check
  const teamConfig = await getTeamConfig(db);

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

  const results = {
    processed: 0,
    errors: [] as string[],
    sessions_created: 0,
    sessions_ended: 0,
    file_ops_created: 0,
    prompts_created: 0,
    agent_responses_created: 0,
  };

  // ── Phase 1: Pre-cache unique sessions and repos (few queries) ──────
  const uniqueSessionIds = [...new Set(payload.events.map((e) => e.session_id))];
  const uniqueRepoNames = [...new Set(payload.events.map((e) => e.repo_name))];

  const sessionCache = new Map<string, Session>();
  const repoCache = new Map<string, Repo | null>();

  // Lookup each unique session (typically 1-3 per batch)
  for (const id of uniqueSessionIds) {
    const session = await getSessionById(db, id);
    if (session) sessionCache.set(id, session);
  }

  // Lookup each unique repo (typically 1-2 per batch)
  for (const name of uniqueRepoNames) {
    repoCache.set(name, await getRepoByName(db, name));
  }

  // ── Phase 2: Process events, collecting batch statements ────────────
  const statements: D1PreparedStatement[] = [];
  const reposWithFileOps = new Set<string>();
  const sessionsForSummary = new Set<string>();
  const endedSessions = new Set<string>();
  const eventCountIncrements = new Map<string, number>();
  const promptsForClassification: Array<{ sessionId: string; userId: string; repoName: string; promptText: string; timestamp: string }> = [];

  for (const event of payload.events) {
    try {
      if (event.user_id !== member.user_id) {
        results.errors.push(`Event user_id ${event.user_id} doesn't match authenticated user ${member.user_id}`);
        continue;
      }

      const repoId = repoCache.get(event.repo_name)?.id ?? null;

      switch (event.event_type) {
        case 'session_start': {
          const existing = sessionCache.get(event.session_id);
          if (existing) {
            // Only reactivate if this is a genuinely recent session_start, not a backfill
            if (existing.status === 'stale' || existing.status === 'ended') {
              const eventAge = Date.now() - new Date(event.timestamp).getTime();
              const staleMs = (teamConfig?.stale_timeout_hours ?? 8) * 60 * 60 * 1000;
              if (eventAge < staleMs) {
                statements.push(
                  db.prepare(`UPDATE sessions SET status = 'active', ended_at = NULL WHERE id = ?`).bind(event.session_id)
                );
              }
            }
            // Backfill null git_branch/model
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
              statements.push(
                db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).bind(...values)
              );
            }
          } else {
            // Create new session
            statements.push(
              db.prepare(
                `INSERT INTO sessions (id, user_id, repo_id, repo_name, agent_type, agent_version, cwd, git_branch, model, hostname, device_name, is_remote, started_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
              ).bind(
                event.session_id,
                event.user_id,
                repoId,
                event.repo_name,
                event.agent_type,
                event.agent_version ?? null,
                event.cwd ?? null,
                event.git_branch ?? null,
                event.model ?? null,
                event.hostname ?? null,
                event.device_name ?? null,
                event.is_remote ? 1 : 0,
                event.timestamp
              )
            );
            // Mark as cached so subsequent events in this batch skip creation
            sessionCache.set(event.session_id, { id: event.session_id, status: 'active' } as Session);
            results.sessions_created++;
          }

          // Store git remote URL on repo (first-write-wins)
          if (event.git_remote_url && repoId) {
            statements.push(
              db.prepare(`UPDATE repos SET remote_url = ? WHERE id = ? AND remote_url IS NULL`)
                .bind(event.git_remote_url, repoId)
            );
          }
          break;
        }

        case 'session_end': {
          // Ensure session exists
          if (!sessionCache.has(event.session_id)) {
            statements.push(
              db.prepare(
                `INSERT INTO sessions (id, user_id, repo_id, repo_name, agent_type, started_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, 'active')`
              ).bind(event.session_id, event.user_id, repoId, event.repo_name, event.agent_type, event.timestamp)
            );
            sessionCache.set(event.session_id, { id: event.session_id, status: 'active' } as Session);
            results.sessions_created++;
          }

          statements.push(
            db.prepare(
              `UPDATE sessions SET
                status = 'ended', ended_at = ?,
                total_cost_usd = COALESCE(?, total_cost_usd),
                duration_ms = COALESCE(?, duration_ms),
                num_turns = COALESCE(?, num_turns),
                total_input_tokens = COALESCE(?, total_input_tokens),
                total_output_tokens = COALESCE(?, total_output_tokens),
                cache_creation_tokens = COALESCE(?, cache_creation_tokens),
                cache_read_tokens = COALESCE(?, cache_read_tokens),
                result_summary = COALESCE(?, result_summary)
               WHERE id = ?`
            ).bind(
              event.timestamp,
              event.total_cost_usd ?? null,
              event.duration_ms ?? null,
              event.num_turns ?? null,
              event.total_input_tokens ?? null,
              event.total_output_tokens ?? null,
              event.cache_creation_tokens ?? null,
              event.cache_read_tokens ?? null,
              event.result_summary ?? null,
              event.session_id
            )
          );
          results.sessions_ended++;
          endedSessions.add(event.session_id);
          break;
        }

        case 'file_op': {
          // Ensure session exists
          if (!sessionCache.has(event.session_id)) {
            statements.push(
              db.prepare(
                `INSERT INTO sessions (id, user_id, repo_id, repo_name, agent_type, started_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, 'active')`
              ).bind(event.session_id, event.user_id, repoId, event.repo_name, event.agent_type, event.timestamp)
            );
            sessionCache.set(event.session_id, { id: event.session_id, status: 'active' } as Session);
            results.sessions_created++;
          }

          statements.push(
            db.prepare(
              `INSERT INTO file_operations (session_id, user_id, repo_id, repo_name, agent_type, timestamp, tool_name, file_path, operation, start_line, end_line, function_name, bash_command, old_string, new_string)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              event.session_id,
              event.user_id,
              repoId,
              event.repo_name,
              event.agent_type,
              event.timestamp,
              event.tool_name ?? null,
              event.file_path ?? null,
              event.operation ?? null,
              event.start_line ?? null,
              event.end_line ?? null,
              event.function_name ?? null,
              event.bash_command ?? null,
              event.old_string ?? null,
              event.new_string ?? null
            )
          );
          results.file_ops_created++;
          reposWithFileOps.add(event.repo_name);
          eventCountIncrements.set(event.session_id, (eventCountIncrements.get(event.session_id) ?? 0) + 1);
          sessionsForSummary.add(event.session_id);
          break;
        }

        case 'prompt': {
          // Ensure session exists
          if (!sessionCache.has(event.session_id)) {
            statements.push(
              db.prepare(
                `INSERT INTO sessions (id, user_id, repo_id, repo_name, agent_type, started_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, 'active')`
              ).bind(event.session_id, event.user_id, repoId, event.repo_name, event.agent_type, event.timestamp)
            );
            sessionCache.set(event.session_id, { id: event.session_id, status: 'active' } as Session);
            results.sessions_created++;
          }

          statements.push(
            db.prepare(
              `INSERT INTO prompts (session_id, user_id, repo_id, repo_name, agent_type, timestamp, prompt_text, turn_number)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              event.session_id,
              event.user_id,
              repoId,
              event.repo_name,
              event.agent_type,
              event.timestamp,
              event.prompt_text ?? null,
              event.turn_number ?? null
            )
          );
          results.prompts_created++;
          eventCountIncrements.set(event.session_id, (eventCountIncrements.get(event.session_id) ?? 0) + 1);
          sessionsForSummary.add(event.session_id);

          // Collect for activity classification
          if (event.prompt_text) {
            promptsForClassification.push({
              sessionId: event.session_id,
              userId: event.user_id,
              repoName: event.repo_name,
              promptText: event.prompt_text,
              timestamp: event.timestamp,
            });
          }
          break;
        }

        case 'agent_response': {
          // Ensure session exists
          if (!sessionCache.has(event.session_id)) {
            statements.push(
              db.prepare(
                `INSERT INTO sessions (id, user_id, repo_id, repo_name, agent_type, started_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, 'active')`
              ).bind(event.session_id, event.user_id, repoId, event.repo_name, event.agent_type, event.timestamp)
            );
            sessionCache.set(event.session_id, { id: event.session_id, status: 'active' } as Session);
            results.sessions_created++;
          }

          statements.push(
            db.prepare(
              `INSERT INTO agent_responses (session_id, user_id, repo_id, repo_name, agent_type, timestamp, response_text, response_type, turn_number)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              event.session_id,
              event.user_id,
              repoId,
              event.repo_name,
              event.agent_type,
              event.timestamp,
              event.response_text ?? null,
              event.response_type ?? 'text',
              event.turn_number ?? null
            )
          );
          results.agent_responses_created++;
          eventCountIncrements.set(event.session_id, (eventCountIncrements.get(event.session_id) ?? 0) + 1);
          sessionsForSummary.add(event.session_id);
          break;
        }

        default:
          throw new Error(`Unknown event type: ${(event as IngestEvent).event_type}`);
      }

      results.processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.errors.push(`Error processing event ${event.event_type} for session ${event.session_id}: ${message}`);
    }
  }

  // ── Phase 3: Add event count increments + member active ─────────────
  for (const [sessionId, count] of eventCountIncrements) {
    statements.push(
      db.prepare(`UPDATE sessions SET summary_event_count = summary_event_count + ? WHERE id = ?`).bind(count, sessionId)
    );
  }
  statements.push(
    db.prepare(`UPDATE members SET last_active_at = datetime('now') WHERE user_id = ?`).bind(member.user_id)
  );

  // ── Phase 4: Execute all statements in one batch round-trip ─────────
  if (statements.length > 0) {
    await db.batch(statements);
  }

  // ── Phase 5: Background post-processing (waitUntil) ─────────────────
  const encryptionKey = context.locals.runtime.env.TEAM_ENCRYPTION_KEY;

  for (const repoName of reposWithFileOps) {
    context.locals.runtime.ctx.waitUntil(detectFileOverlaps(db, repoName));
  }
  for (const sessionId of sessionsForSummary) {
    context.locals.runtime.ctx.waitUntil(maybeGenerateSummary(db, sessionId, encryptionKey));
  }
  for (const sessionId of endedSessions) {
    context.locals.runtime.ctx.waitUntil(generateSessionSummary(db, sessionId, encryptionKey));
  }
  for (const p of promptsForClassification) {
    context.locals.runtime.ctx.waitUntil(
      classifyActivity(db, p.sessionId, p.userId, p.repoName, p.promptText, p.timestamp, encryptionKey)
    );
  }

  return successResponse(results);
}

// Type declaration for D1Database (imported from workers-types)
type D1Database = import('@cloudflare/workers-types').D1Database;
type D1PreparedStatement = import('@cloudflare/workers-types').D1PreparedStatement;
