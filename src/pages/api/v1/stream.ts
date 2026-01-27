import type { APIContext } from 'astro';
import type { SessionWithDetails } from '@lib/db/types';
import { authenticateAny, errorResponse } from '@lib/auth/middleware';
import { getRecentActivity, markStaleSessions } from '@lib/db/queries';

const POLL_INTERVAL_MS = 3000; // Poll database every 3 seconds
const KEEPALIVE_INTERVAL_MS = 15000; // Send keepalive every 15 seconds
const STALE_CHECK_INTERVAL_MS = 30000; // Check for stale sessions every 30 seconds

function formatSession(session: SessionWithDetails) {
  return {
    id: session.id,
    user: session.user,
    device: {
      id: session.device.id,
      name: session.device.name,
      is_remote: session.device.is_remote === 1,
    },
    repo: session.repo,
    branch: session.branch,
    worktree: session.worktree,
    status: session.status,
    started_at: session.started_at,
    last_activity_at: session.last_activity_at,
    activity: session.latest_activity
      ? {
          semantic_scope: session.latest_activity.semantic_scope,
          summary: session.latest_activity.summary,
          files: session.latest_activity.files,
          created_at: session.latest_activity.created_at,
        }
      : null,
  };
}

/**
 * Build a fingerprint string for a session that changes whenever something
 * the client cares about has changed (new activity, status change, etc.).
 */
function sessionFingerprint(session: SessionWithDetails): string {
  return [
    session.status,
    session.last_activity_at,
    session.latest_activity?.id ?? '',
    session.latest_activity?.created_at ?? '',
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
  const { team } = authResult.context;

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
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ team_id: team.id })}\n\n`)
      );

      // Snapshot-diff approach: track fingerprint of each session
      // so we detect ANY change (new activity, status change, new session, removed session)
      let knownSessions = new Map<string, string>(); // sessionId -> fingerprint
      let lastKeepalive = Date.now();
      let lastStaleCheck = Date.now();
      let eventCounter = 0;

      // Polling loop
      while (isActive) {
        try {
          // Periodically mark stale sessions (not every poll — it's a write operation)
          const now = Date.now();
          if (now - lastStaleCheck > STALE_CHECK_INTERVAL_MS) {
            await markStaleSessions(db);
            lastStaleCheck = now;
          }

          // Fetch current sessions
          const result = await getRecentActivity(db, team.id, { limit: 50 });

          // Build new snapshot
          const currentSessions = new Map<string, SessionWithDetails>();
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

          // Wait before next poll
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
