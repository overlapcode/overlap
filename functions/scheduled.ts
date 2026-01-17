/**
 * Scheduled worker to mark stale sessions.
 *
 * Runs every hour to find sessions without recent activity and mark them as stale.
 * This is configured via the [[triggers]] in wrangler.toml.
 */

type Env = {
  DB: D1Database;
};

export const onSchedule: PagesFunction<Env> = async (context) => {
  const { env } = context;

  try {
    // Get the default stale timeout from team settings
    const team = await env.DB
      .prepare('SELECT stale_timeout_hours FROM teams LIMIT 1')
      .first<{ stale_timeout_hours: number }>();

    const defaultTimeout = team?.stale_timeout_hours ?? 8;

    // Mark sessions as stale based on user-specific or team default timeout
    // Uses COALESCE to prefer user's timeout, falling back to team default
    const result = await env.DB
      .prepare(
        `UPDATE sessions
         SET status = 'stale'
         WHERE status = 'active'
         AND datetime(last_activity_at, '+' ||
           COALESCE(
             (SELECT stale_timeout_hours FROM users WHERE users.id = sessions.user_id),
             ?
           ) || ' hours'
         ) < datetime('now')`
      )
      .bind(defaultTimeout)
      .run();

    console.log(`Marked ${result.meta.changes ?? 0} sessions as stale`);

    // Clean up old magic links
    const cleanupResult = await env.DB
      .prepare(
        `DELETE FROM magic_links
         WHERE expires_at < datetime('now')
         OR used_at IS NOT NULL`
      )
      .run();

    console.log(`Cleaned up ${cleanupResult.meta.changes ?? 0} expired magic links`);

    // Clean up old web sessions
    const sessionCleanup = await env.DB
      .prepare(
        `DELETE FROM web_sessions
         WHERE expires_at < datetime('now')`
      )
      .run();

    console.log(`Cleaned up ${sessionCleanup.meta.changes ?? 0} expired web sessions`);

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Scheduled task error:', error);
    return new Response('Error', { status: 500 });
  }
};
