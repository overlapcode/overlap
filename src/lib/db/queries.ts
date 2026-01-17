import type { D1Database } from '@cloudflare/workers-types';
import type {
  Team,
  User,
  Device,
  Repo,
  Session,
  Activity,
  SessionWithDetails,
} from './types';

// ============================================================================
// TEAM QUERIES
// ============================================================================

export async function getTeam(db: D1Database): Promise<Team | null> {
  // Single-tenant: there's only one team per deployment
  return db.prepare('SELECT * FROM teams LIMIT 1').first<Team>();
}

export async function createTeam(
  db: D1Database,
  data: Pick<Team, 'id' | 'name' | 'team_token' | 'dashboard_password_hash'>
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO teams (id, name, team_token, dashboard_password_hash)
       VALUES (?, ?, ?, ?)`
    )
    .bind(data.id, data.name, data.team_token, data.dashboard_password_hash)
    .run();
}

export async function updateTeamSettings(
  db: D1Database,
  teamId: string,
  settings: Partial<Pick<Team, 'llm_provider' | 'llm_model' | 'llm_api_key_encrypted' | 'stale_timeout_hours' | 'is_public'>>
): Promise<void> {
  const updates: string[] = [];
  const values: unknown[] = [];

  if (settings.llm_provider !== undefined) {
    updates.push('llm_provider = ?');
    values.push(settings.llm_provider);
  }
  if (settings.llm_model !== undefined) {
    updates.push('llm_model = ?');
    values.push(settings.llm_model);
  }
  if (settings.llm_api_key_encrypted !== undefined) {
    updates.push('llm_api_key_encrypted = ?');
    values.push(settings.llm_api_key_encrypted);
  }
  if (settings.stale_timeout_hours !== undefined) {
    updates.push('stale_timeout_hours = ?');
    values.push(settings.stale_timeout_hours);
  }
  if (settings.is_public !== undefined) {
    updates.push('is_public = ?');
    values.push(settings.is_public);
  }

  if (updates.length === 0) return;

  updates.push("updated_at = datetime('now')");
  values.push(teamId);

  await db
    .prepare(`UPDATE teams SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

// ============================================================================
// USER QUERIES
// ============================================================================

export async function getUserByToken(db: D1Database, userToken: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE user_token = ?').bind(userToken).first<User>();
}

export async function getUserById(db: D1Database, userId: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>();
}

export async function getTeamUsers(db: D1Database, teamId: string): Promise<User[]> {
  const result = await db
    .prepare('SELECT * FROM users WHERE team_id = ? AND is_active = 1 ORDER BY name')
    .bind(teamId)
    .all<User>();
  return result.results;
}

export async function createUser(
  db: D1Database,
  data: Pick<User, 'id' | 'team_id' | 'user_token' | 'name' | 'email' | 'role'>
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, team_id, user_token, name, email, role)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(data.id, data.team_id, data.user_token, data.name, data.email, data.role)
    .run();
}

export async function updateUserRole(db: D1Database, userId: string, role: 'admin' | 'member'): Promise<void> {
  await db
    .prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(role, userId)
    .run();
}

// ============================================================================
// DEVICE QUERIES
// ============================================================================

export async function getOrCreateDevice(
  db: D1Database,
  userId: string,
  hostname: string,
  isRemote: boolean,
  name: string
): Promise<Device> {
  // Try to find existing device
  const existing = await db
    .prepare('SELECT * FROM devices WHERE user_id = ? AND hostname = ? AND is_remote = ?')
    .bind(userId, hostname, isRemote ? 1 : 0)
    .first<Device>();

  if (existing) {
    // Update last seen
    await db
      .prepare("UPDATE devices SET last_seen_at = datetime('now'), name = ? WHERE id = ?")
      .bind(name, existing.id)
      .run();
    return { ...existing, last_seen_at: new Date().toISOString(), name };
  }

  // Create new device
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO devices (id, user_id, name, hostname, is_remote, last_seen_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(id, userId, name, hostname, isRemote ? 1 : 0)
    .run();

  return db.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first<Device>() as Promise<Device>;
}

// ============================================================================
// REPO QUERIES
// ============================================================================

export async function getOrCreateRepo(
  db: D1Database,
  teamId: string,
  remoteUrl: string | null,
  name: string
): Promise<Repo> {
  if (remoteUrl) {
    // Try to find by remote URL
    const existing = await db
      .prepare('SELECT * FROM repos WHERE team_id = ? AND remote_url = ?')
      .bind(teamId, remoteUrl)
      .first<Repo>();

    if (existing) return existing;
  }

  // Create new repo
  const id = crypto.randomUUID();
  const repoToken = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO repos (id, team_id, name, remote_url, repo_token)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, teamId, name, remoteUrl, repoToken)
    .run();

  return db.prepare('SELECT * FROM repos WHERE id = ?').bind(id).first<Repo>() as Promise<Repo>;
}

export async function getTeamRepos(db: D1Database, teamId: string): Promise<Repo[]> {
  const result = await db
    .prepare('SELECT * FROM repos WHERE team_id = ? ORDER BY name')
    .bind(teamId)
    .all<Repo>();
  return result.results;
}

// ============================================================================
// SESSION QUERIES
// ============================================================================

export async function createSession(
  db: D1Database,
  data: Pick<Session, 'id' | 'user_id' | 'device_id' | 'repo_id' | 'branch' | 'worktree'>
): Promise<Session> {
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, device_id, repo_id, branch, worktree)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(data.id, data.user_id, data.device_id, data.repo_id, data.branch, data.worktree)
    .run();

  return db.prepare('SELECT * FROM sessions WHERE id = ?').bind(data.id).first<Session>() as Promise<Session>;
}

export async function updateSessionActivity(db: D1Database, sessionId: string): Promise<void> {
  await db
    .prepare("UPDATE sessions SET last_activity_at = datetime('now'), status = 'active' WHERE id = ?")
    .bind(sessionId)
    .run();
}

export async function endSession(db: D1Database, sessionId: string): Promise<void> {
  await db
    .prepare("UPDATE sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?")
    .bind(sessionId)
    .run();
}

export async function getActiveSessionsForUser(db: D1Database, userId: string): Promise<Session[]> {
  const result = await db
    .prepare("SELECT * FROM sessions WHERE user_id = ? AND status = 'active' ORDER BY last_activity_at DESC")
    .bind(userId)
    .all<Session>();
  return result.results;
}

export async function getSessionById(db: D1Database, sessionId: string): Promise<Session | null> {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').bind(sessionId).first<Session>();
}

// ============================================================================
// ACTIVITY QUERIES
// ============================================================================

export async function createActivity(
  db: D1Database,
  data: Pick<Activity, 'id' | 'session_id' | 'files' | 'semantic_scope' | 'summary'>
): Promise<Activity> {
  await db
    .prepare(
      `INSERT INTO activity (id, session_id, files, semantic_scope, summary)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(data.id, data.session_id, data.files, data.semantic_scope, data.summary)
    .run();

  // Also update session last_activity_at
  await updateSessionActivity(db, data.session_id);

  return db.prepare('SELECT * FROM activity WHERE id = ?').bind(data.id).first<Activity>() as Promise<Activity>;
}

export async function getRecentActivity(
  db: D1Database,
  teamId: string,
  limit = 50
): Promise<SessionWithDetails[]> {
  // Get recent sessions with their latest activity
  const result = await db
    .prepare(
      `SELECT
        s.*,
        u.id as user_id, u.name as user_name,
        d.id as device_id, d.name as device_name, d.is_remote as device_is_remote,
        r.id as repo_id, r.name as repo_name,
        a.id as activity_id, a.files, a.semantic_scope, a.summary, a.created_at as activity_created_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      JOIN devices d ON s.device_id = d.id
      LEFT JOIN repos r ON s.repo_id = r.id
      LEFT JOIN (
        SELECT session_id, id, files, semantic_scope, summary, created_at,
               ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC) as rn
        FROM activity
      ) a ON s.id = a.session_id AND a.rn = 1
      WHERE u.team_id = ?
      AND s.status IN ('active', 'stale')
      ORDER BY s.last_activity_at DESC
      LIMIT ?`
    )
    .bind(teamId, limit)
    .all();

  return result.results.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    user_id: row.user_id as string,
    device_id: row.device_id as string,
    repo_id: row.repo_id as string | null,
    branch: row.branch as string | null,
    worktree: row.worktree as string | null,
    status: row.status as 'active' | 'stale' | 'ended',
    started_at: row.started_at as string,
    last_activity_at: row.last_activity_at as string,
    ended_at: row.ended_at as string | null,
    user: {
      id: row.user_id as string,
      name: row.user_name as string,
    },
    device: {
      id: row.device_id as string,
      name: row.device_name as string,
      is_remote: row.device_is_remote as number,
    },
    repo: row.repo_id
      ? {
          id: row.repo_id as string,
          name: row.repo_name as string,
        }
      : null,
    latest_activity: row.activity_id
      ? {
          id: row.activity_id as string,
          session_id: row.id as string,
          files: JSON.parse(row.files as string) as string[],
          semantic_scope: row.semantic_scope as string | null,
          summary: row.summary as string | null,
          created_at: row.activity_created_at as string,
        }
      : null,
  }));
}

// ============================================================================
// OVERLAP DETECTION
// ============================================================================

export async function checkForOverlaps(
  db: D1Database,
  teamId: string,
  userId: string,
  files: string[],
  semanticScope: string | null
): Promise<SessionWithDetails[]> {
  // Find active sessions from OTHER users that overlap
  // Overlap = same files OR same semantic scope

  const filePatterns = files.map((f) => `%${f}%`);

  let query = `
    SELECT DISTINCT
      s.*,
      u.id as user_id, u.name as user_name,
      d.id as device_id, d.name as device_name, d.is_remote as device_is_remote,
      r.id as repo_id, r.name as repo_name,
      a.id as activity_id, a.files, a.semantic_scope, a.summary, a.created_at as activity_created_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    JOIN devices d ON s.device_id = d.id
    LEFT JOIN repos r ON s.repo_id = r.id
    LEFT JOIN activity a ON s.id = a.session_id
    WHERE u.team_id = ?
    AND s.user_id != ?
    AND s.status = 'active'
    AND (
  `;

  const bindParams: unknown[] = [teamId, userId];

  // Add file overlap conditions
  const fileConditions = filePatterns.map(() => 'a.files LIKE ?');
  query += fileConditions.join(' OR ');
  bindParams.push(...filePatterns);

  // Add semantic scope overlap if provided
  if (semanticScope) {
    query += ' OR a.semantic_scope = ?';
    bindParams.push(semanticScope);
  }

  query += `) ORDER BY s.last_activity_at DESC LIMIT 10`;

  const result = await db
    .prepare(query)
    .bind(...bindParams)
    .all();

  return result.results.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    user_id: row.user_id as string,
    device_id: row.device_id as string,
    repo_id: row.repo_id as string | null,
    branch: row.branch as string | null,
    worktree: row.worktree as string | null,
    status: row.status as 'active' | 'stale' | 'ended',
    started_at: row.started_at as string,
    last_activity_at: row.last_activity_at as string,
    ended_at: row.ended_at as string | null,
    user: {
      id: row.user_id as string,
      name: row.user_name as string,
    },
    device: {
      id: row.device_id as string,
      name: row.device_name as string,
      is_remote: row.device_is_remote as number,
    },
    repo: row.repo_id
      ? {
          id: row.repo_id as string,
          name: row.repo_name as string,
        }
      : null,
    latest_activity: row.activity_id
      ? {
          id: row.activity_id as string,
          session_id: row.id as string,
          files: JSON.parse(row.files as string) as string[],
          semantic_scope: row.semantic_scope as string | null,
          summary: row.summary as string | null,
          created_at: row.activity_created_at as string,
        }
      : null,
  }));
}

// ============================================================================
// STALE SESSION CLEANUP (on-demand, since Pages doesn't support cron)
// ============================================================================

/**
 * Mark sessions as stale if they haven't had activity within the configured timeout.
 * This runs on-demand when fetching activity, rather than via cron.
 * Returns the number of sessions marked as stale.
 */
export async function markStaleSessions(db: D1Database): Promise<number> {
  // Get the default stale timeout from team settings
  const team = await db
    .prepare('SELECT stale_timeout_hours FROM teams LIMIT 1')
    .first<{ stale_timeout_hours: number }>();

  const defaultTimeout = team?.stale_timeout_hours ?? 8;

  // Mark sessions as stale based on user-specific or team default timeout
  // Uses COALESCE to prefer user's timeout, falling back to team default
  const result = await db
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

  return result.meta.changes ?? 0;
}

/**
 * Clean up expired magic links and web sessions.
 * Call this periodically (e.g., when fetching activity).
 */
export async function cleanupExpiredTokens(db: D1Database): Promise<void> {
  // Clean up old magic links
  await db
    .prepare(
      `DELETE FROM magic_links
       WHERE expires_at < datetime('now')
       OR used_at IS NOT NULL`
    )
    .run();

  // Clean up old web sessions
  await db
    .prepare(
      `DELETE FROM web_sessions
       WHERE expires_at < datetime('now')`
    )
    .run();
}
