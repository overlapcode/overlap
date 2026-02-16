import type { APIContext } from 'astro';
import type { SessionWithMember } from '@lib/db/types';
import { authenticateAny, errorResponse } from '@lib/auth/middleware';
import { getSessions, markStaleSessions } from '@lib/db/queries';

const POLL_INTERVAL_MS = 1000; // Check for changes every 1 second
const KEEPALIVE_INTERVAL_MS = 15000; // Send keepalive every 15 seconds
const STALE_CHECK_INTERVAL_MS = 30000; // Check for stale sessions every 30 seconds

function formatSession(session: SessionWithMember) {
  return {
    id: session.id,
    user: {
      id: session.member.user_id,
      name: session.member.display_name,
    },
    device: {
      id: 'default',
      name: 'local',
      is_remote: false,
    },
    repo: session.repo
      ? {
          id: session.repo.id,
          name: session.repo.name,
          remote_url: null,
        }
      : {
          id: 'unknown',
          name: session.repo_name,
          remote_url: null,
        },
    branch: session.git_branch,
    worktree: null,
    status: session.status,
    started_at: session.started_at,
    last_activity_at: session.last_activity_at || session.started_at,
    ended_at: session.ended_at,
    agent_type: session.agent_type,
    model: session.model,
    total_cost_usd: session.total_cost_usd,
    num_turns: session.num_turns,
    duration_ms: session.duration_ms,
    activity: session.generated_summary || session.result_summary
      ? {
          semantic_scope: null,
          summary: session.generated_summary || session.result_summary,
          files: [],
          created_at: session.started_at,
        }
      : null,
  };
}

/**
 * Build a fingerprint string for a session that changes whenever something
 * the client cares about has changed (new activity, status change, etc.).
 */
function sessionFingerprint(session: SessionWithMember): string {
  return [
    session.status,
    session.ended_at ?? '',
    session.generated_summary ?? '',
    session.num_turns,
    session.last_activity_at ?? '',
  ].join('|');
}

export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let isActive = true;

      // Handle abort
      request.signal.addEventListener('abort', () => {
        isActive = false;
        try { controller.close(); } catch { /* already closed */ }
      });

      // Send initial connected event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`)
      );

      // Snapshot-diff approach: track fingerprint of each session
      // so we detect ANY change (new activity, status change, new session, removed session)
      let knownSessions = new Map<string, string>(); // sessionId -> fingerprint
      let lastKeepalive = Date.now();
      let lastStaleCheck = Date.now();
      let eventCounter = 0;
      let lastChangeSignature = ''; // lightweight change detection

      // Polling loop
      while (isActive) {
        try {
          // Periodically mark stale sessions (not every poll — it's a write operation)
          const now = Date.now();
          if (now - lastStaleCheck > STALE_CHECK_INTERVAL_MS) {
            await markStaleSessions(db);
            lastStaleCheck = now;
          }

          // Lightweight change check: single-row query to detect if anything changed
          const changeCheck = await db
            .prepare(
              `SELECT COUNT(*) as cnt, MAX(started_at) as latest, SUM(summary_event_count) as events
               FROM sessions
               WHERE status IN ('active', 'stale')`
            )
            .first<{ cnt: number; latest: string | null; events: number | null }>();

          const sig = `${changeCheck?.cnt ?? 0}|${changeCheck?.latest ?? ''}|${changeCheck?.events ?? 0}`;

          // Skip full query if nothing changed (after initial load)
          if (sig === lastChangeSignature && knownSessions.size > 0) {
            // No change — just send keepalive if needed
            const nowAfterCheck = Date.now();
            if (nowAfterCheck - lastKeepalive > KEEPALIVE_INTERVAL_MS) {
              controller.enqueue(encoder.encode(': keepalive\n\n'));
              lastKeepalive = nowAfterCheck;
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
            continue;
          }
          lastChangeSignature = sig;

          // Something changed — fetch full session data
          const result = await getSessions(db, { limit: 50, status: 'active_or_stale' });

          // Build new snapshot
          const currentSessions = new Map<string, SessionWithMember>();
          for (const session of result.sessions) {
            currentSessions.set(session.id, session);
          }

          // Detect changes: new sessions, updated sessions
          for (const [id, session] of currentSessions) {
            const fp = sessionFingerprint(session);
            const prevFp = knownSessions.get(id);

            if (prevFp !== fp) {
              // New or changed session — send event
              eventCounter++;
              controller.enqueue(
                encoder.encode(
                  `id: ${eventCounter}\nevent: activity\ndata: ${JSON.stringify(formatSession(session))}\n\n`
                )
              );
            }
          }

          // Update known state
          knownSessions = new Map();
          for (const [id, session] of currentSessions) {
            knownSessions.set(id, sessionFingerprint(session));
          }

          // Send keepalive if needed
          const nowAfterPoll = Date.now();
          if (nowAfterPoll - lastKeepalive > KEEPALIVE_INTERVAL_MS) {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
            lastKeepalive = nowAfterPoll;
          }

          // Wait before next check
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        } catch (error) {
          if (!isActive) break;
          console.error('SSE stream error:', error);

          // Send error event
          try {
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ message: 'Stream error' })}\n\n`)
            );
          } catch { /* stream may be closed */ }

          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * 3));
        }
      }
    },
  });

  const origin = request.headers.get('Origin');
  const requestUrl = new URL(request.url);
  const allowedOrigin = origin === requestUrl.origin ? origin : requestUrl.origin;

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': allowedOrigin,
      Vary: 'Origin',
    },
  });
}
