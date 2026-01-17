import type { APIContext } from 'astro';
import { authenticateRequest, errorResponse } from '@lib/auth/middleware';
import { getRecentActivity } from '@lib/db/queries';

const POLL_INTERVAL_MS = 5000; // Poll database every 5 seconds
const KEEPALIVE_INTERVAL_MS = 30000; // Send keepalive every 30 seconds

export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate
  const authResult = await authenticateRequest(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }
  const { team } = authResult.context;

  // Get Last-Event-ID header for resuming
  const lastEventId = request.headers.get('Last-Event-ID');
  let lastSeenTimestamp = lastEventId ? new Date(lastEventId) : new Date(0);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let isActive = true;

      // Handle abort
      request.signal.addEventListener('abort', () => {
        isActive = false;
        controller.close();
      });

      // Send initial connected event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ team_id: team.id })}\n\n`)
      );

      let lastKeepalive = Date.now();

      // Polling loop
      while (isActive) {
        try {
          // Check for new activity
          const sessions = await getRecentActivity(db, team.id, 20);

          // Filter to only new activity since last seen
          const newSessions = sessions.filter((s) => {
            const activityTime = s.latest_activity
              ? new Date(s.latest_activity.created_at)
              : new Date(s.last_activity_at);
            return activityTime > lastSeenTimestamp;
          });

          // Send new events
          for (const session of newSessions) {
            const eventData = {
              session_id: session.id,
              user: session.user,
              device: {
                id: session.device.id,
                name: session.device.name,
                is_remote: session.device.is_remote === 1,
              },
              repo: session.repo,
              branch: session.branch,
              status: session.status,
              last_activity_at: session.last_activity_at,
              activity: session.latest_activity
                ? {
                    semantic_scope: session.latest_activity.semantic_scope,
                    summary: session.latest_activity.summary,
                    files: session.latest_activity.files,
                  }
                : null,
            };

            const timestamp = session.latest_activity?.created_at || session.last_activity_at;
            controller.enqueue(
              encoder.encode(
                `id: ${timestamp}\nevent: activity\ndata: ${JSON.stringify(eventData)}\n\n`
              )
            );

            // Update last seen
            const eventTime = new Date(timestamp);
            if (eventTime > lastSeenTimestamp) {
              lastSeenTimestamp = eventTime;
            }
          }

          // Send keepalive if needed
          const now = Date.now();
          if (now - lastKeepalive > KEEPALIVE_INTERVAL_MS) {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
            lastKeepalive = now;
          }

          // Wait before next poll
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        } catch (error) {
          console.error('SSE stream error:', error);

          // Send error event
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ message: 'Stream error' })}\n\n`)
          );

          // Wait a bit before retrying
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * 2));
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
