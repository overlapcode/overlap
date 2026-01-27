import type { D1Database } from '@cloudflare/workers-types';
import type {
  Team,
  User,
  Device,
  Repo,
  Session,
  Activity,
  ParsedActivity,
  SessionWithDetails,
  PluginLog,
  PluginLogWithUser,
} from './types';

function safeParseFiles(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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

export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  // Delete related data first (due to foreign key constraints), batched for atomicity
  await db.batch([
    db.prepare('DELETE FROM web_sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM magic_links WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM activity WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)').bind(userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM devices WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
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

export async function getUserRepos(db: D1Database, teamId: string, userId: string): Promise<Repo[]> {
  // Get repos where the user has at least one session
  const result = await db
    .prepare(
      `SELECT DISTINCT r.*
       FROM repos r
       JOIN sessions s ON s.repo_id = r.id
       WHERE r.team_id = ? AND s.user_id = ?
       ORDER BY r.name`
    )
    .bind(teamId, userId)
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
    .prepare("UPDATE sessions SET last_activity_at = datetime('now'), status = 'active', ended_at = NULL WHERE id = ?")
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
  const insertStmt = db
    .prepare(
      `INSERT INTO activity (id, session_id, files, semantic_scope, summary)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(data.id, data.session_id, data.files, data.semantic_scope, data.summary);

  // Reactivate session: set active, update timestamp, clear ended_at (handles stale/ended → active)
  const updateStmt = db
    .prepare(
      "UPDATE sessions SET last_activity_at = datetime('now'), status = 'active', ended_at = NULL WHERE id = ?"
    )
    .bind(data.session_id);

  await db.batch([insertStmt, updateStmt]);

  return db.prepare('SELECT * FROM activity WHERE id = ?').bind(data.id).first<Activity>() as Promise<Activity>;
}

export type PaginatedSessions = {
  sessions: SessionWithDetails[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export async function getRecentActivity(
  db: D1Database,
  teamId: string,
  options: {
    limit?: number;
    offset?: number;
    includeStale?: boolean;
  } = {}
): Promise<PaginatedSessions> {
  const { limit = 20, offset = 0, includeStale = true } = options;

  const statusA = 'active';
  const statusB = includeStale ? 'stale' : 'active';

  // Get total count
  const countResult = await db
    .prepare(
      `SELECT COUNT(*) as count
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE u.team_id = ?
       AND s.status IN (?, ?)`
    )
    .bind(teamId, statusA, statusB)
    .first<{ count: number }>();

  const total = countResult?.count ?? 0;

  // Get recent sessions with their latest activity
  const result = await db
    .prepare(
      `SELECT
        s.*,
        u.id as user_id, u.name as user_name,
        d.id as device_id, d.name as device_name, d.is_remote as device_is_remote,
        r.id as repo_id, r.name as repo_name, r.remote_url as repo_remote_url,
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
      AND s.status IN (?, ?)
      ORDER BY s.last_activity_at DESC
      LIMIT ? OFFSET ?`
    )
    .bind(teamId, statusA, statusB, limit, offset)
    .all();

  const sessions = result.results.map((row: Record<string, unknown>) => ({
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
          remote_url: row.repo_remote_url as string | null,
        }
      : null,
    latest_activity: row.activity_id
      ? {
          id: row.activity_id as string,
          session_id: row.id as string,
          files: safeParseFiles(row.files as string),
          semantic_scope: row.semantic_scope as string | null,
          summary: row.summary as string | null,
          created_at: row.activity_created_at as string,
        }
      : null,
  }));

  return {
    sessions,
    total,
    limit,
    offset,
    hasMore: offset + sessions.length < total,
  };
}

export type UserActivitySummary = {
  userId: string;
  userName: string;
  sessionCount: number;
  latestActivity: string;
};

export async function getActivityByUser(
  db: D1Database,
  teamId: string,
  includeStale: boolean = true
): Promise<UserActivitySummary[]> {
  const statusA = 'active';
  const statusB = includeStale ? 'stale' : 'active';

  const result = await db
    .prepare(
      `SELECT
        u.id as user_id,
        u.name as user_name,
        COUNT(s.id) as session_count,
        MAX(s.last_activity_at) as latest_activity
      FROM users u
      JOIN sessions s ON s.user_id = u.id
      WHERE u.team_id = ?
      AND s.status IN (?, ?)
      GROUP BY u.id, u.name
      ORDER BY latest_activity DESC`
    )
    .bind(teamId, statusA, statusB)
    .all();

  return result.results.map((row: Record<string, unknown>) => ({
    userId: row.user_id as string,
    userName: row.user_name as string,
    sessionCount: row.session_count as number,
    latestActivity: row.latest_activity as string,
  }));
}

export async function getUserSessions(
  db: D1Database,
  teamId: string,
  userId: string,
  options: {
    limit?: number;
    offset?: number;
    includeStale?: boolean;
  } = {}
): Promise<PaginatedSessions> {
  const { limit = 20, offset = 0, includeStale = true } = options;

  const statusA = 'active';
  const statusB = includeStale ? 'stale' : 'active';

  // Get total count for this user
  const countResult = await db
    .prepare(
      `SELECT COUNT(*) as count
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE u.team_id = ?
       AND s.user_id = ?
       AND s.status IN (?, ?)`
    )
    .bind(teamId, userId, statusA, statusB)
    .first<{ count: number }>();

  const total = countResult?.count ?? 0;

  // Get user's sessions with their latest activity
  const result = await db
    .prepare(
      `SELECT
        s.*,
        u.id as user_id, u.name as user_name,
        d.id as device_id, d.name as device_name, d.is_remote as device_is_remote,
        r.id as repo_id, r.name as repo_name, r.remote_url as repo_remote_url,
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
      AND s.user_id = ?
      AND s.status IN (?, ?)
      ORDER BY s.last_activity_at DESC
      LIMIT ? OFFSET ?`
    )
    .bind(teamId, userId, statusA, statusB, limit, offset)
    .all();

  const sessions = result.results.map((row: Record<string, unknown>) => ({
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
          remote_url: row.repo_remote_url as string | null,
        }
      : null,
    latest_activity: row.activity_id
      ? {
          id: row.activity_id as string,
          session_id: row.id as string,
          files: safeParseFiles(row.files as string),
          semantic_scope: row.semantic_scope as string | null,
          summary: row.summary as string | null,
          created_at: row.activity_created_at as string,
        }
      : null,
  }));

  return {
    sessions,
    total,
    limit,
    offset,
    hasMore: offset + sessions.length < total,
  };
}

// ============================================================================
// REPO ACTIVITY QUERIES
// ============================================================================

/**
 * Get distinct branches for a repo (for filter dropdown).
 */
export async function getRepoBranches(db: D1Database, repoId: string): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT branch FROM sessions
       WHERE repo_id = ? AND branch IS NOT NULL
       ORDER BY branch`
    )
    .bind(repoId)
    .all<{ branch: string }>();
  return result.results.map((r) => r.branch);
}

/**
 * Get distinct users who have sessions in a repo (for filter dropdown).
 */
export async function getRepoUsers(
  db: D1Database,
  repoId: string
): Promise<{ id: string; name: string }[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT u.id, u.name
       FROM users u
       JOIN sessions s ON s.user_id = u.id
       WHERE s.repo_id = ?
       ORDER BY u.name`
    )
    .bind(repoId)
    .all<{ id: string; name: string }>();
  return result.results;
}

/**
 * Get paginated sessions for a specific repo, with optional filters.
 */
export async function getRepoActivity(
  db: D1Database,
  teamId: string,
  repoId: string,
  options: {
    limit?: number;
    offset?: number;
    includeStale?: boolean;
    userId?: string;
    branch?: string;
    startDate?: string;
    endDate?: string;
  } = {}
): Promise<PaginatedSessions> {
  const { limit = 20, offset = 0, includeStale = true, userId, branch, startDate, endDate } = options;

  const statusA = 'active';
  const statusB = includeStale ? 'stale' : 'active';

  // Build dynamic WHERE clause
  let whereClause = `WHERE u.team_id = ? AND s.repo_id = ? AND s.status IN (?, ?)`;
  const params: unknown[] = [teamId, repoId, statusA, statusB];

  if (userId) {
    whereClause += ' AND s.user_id = ?';
    params.push(userId);
  }
  if (branch) {
    whereClause += ' AND s.branch = ?';
    params.push(branch);
  }
  if (startDate) {
    whereClause += ' AND s.started_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    whereClause += ' AND s.started_at <= ?';
    params.push(endDate + 'T23:59:59');
  }

  // Get total count
  const countResult = await db
    .prepare(
      `SELECT COUNT(*) as count
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       ${whereClause}`
    )
    .bind(...params)
    .first<{ count: number }>();

  const total = countResult?.count ?? 0;

  // Get sessions with latest activity
  const result = await db
    .prepare(
      `SELECT
        s.*,
        u.id as user_id, u.name as user_name,
        d.id as device_id, d.name as device_name, d.is_remote as device_is_remote,
        r.id as repo_id, r.name as repo_name, r.remote_url as repo_remote_url,
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
      ${whereClause}
      ORDER BY s.last_activity_at DESC
      LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset)
    .all();

  const sessions = result.results.map((row: Record<string, unknown>) => ({
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
          remote_url: row.repo_remote_url as string | null,
        }
      : null,
    latest_activity: row.activity_id
      ? {
          id: row.activity_id as string,
          session_id: row.id as string,
          files: safeParseFiles(row.files as string),
          semantic_scope: row.semantic_scope as string | null,
          summary: row.summary as string | null,
          created_at: row.activity_created_at as string,
        }
      : null,
  }));

  return {
    sessions,
    total,
    limit,
    offset,
    hasMore: offset + sessions.length < total,
  };
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
  // Overlap = exact file match via json_each OR same semantic scope

  const placeholders = files.map(() => '?').join(', ');

  let query = `
    SELECT DISTINCT
      s.*,
      u.id as user_id, u.name as user_name,
      d.id as device_id, d.name as device_name, d.is_remote as device_is_remote,
      r.id as repo_id, r.name as repo_name, r.remote_url as repo_remote_url,
      a.id as activity_id, a.files, a.semantic_scope, a.summary, a.created_at as activity_created_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    JOIN devices d ON s.device_id = d.id
    LEFT JOIN repos r ON s.repo_id = r.id
    JOIN activity a ON s.id = a.session_id
    WHERE u.team_id = ?
    AND s.user_id != ?
    AND s.status = 'active'
    AND (
      EXISTS (
        SELECT 1 FROM json_each(a.files) je
        WHERE je.value IN (${placeholders})
      )`;

  const bindParams: unknown[] = [teamId, userId, ...files];

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
          remote_url: row.repo_remote_url as string | null,
        }
      : null,
    latest_activity: row.activity_id
      ? {
          id: row.activity_id as string,
          session_id: row.id as string,
          files: safeParseFiles(row.files as string),
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
  const team = await db
    .prepare('SELECT stale_timeout_hours FROM teams LIMIT 1')
    .first<{ stale_timeout_hours: number }>();

  const timeout = team?.stale_timeout_hours ?? 8;

  const result = await db
    .prepare(
      `UPDATE sessions
       SET status = 'stale'
       WHERE status = 'active'
       AND last_activity_at < datetime('now', '-' || ? || ' hours')`
    )
    .bind(timeout)
    .run();

  // Also end sessions that have been stale for 24+ hours
  await db
    .prepare(
      `UPDATE sessions
       SET status = 'ended', ended_at = datetime('now')
       WHERE status = 'stale'
       AND last_activity_at < datetime('now', '-24 hours')`
    )
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

// ============================================================================
// PLUGIN LOG QUERIES
// ============================================================================

export async function createPluginLog(
  db: D1Database,
  data: Pick<PluginLog, 'id' | 'user_id' | 'level' | 'hook' | 'session_id' | 'message' | 'data' | 'error'>
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO plugin_logs (id, user_id, level, hook, session_id, message, data, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      data.id,
      data.user_id,
      data.level,
      data.hook,
      data.session_id,
      data.message,
      data.data,
      data.error
    )
    .run();
}

export async function createPluginLogsBatch(
  db: D1Database,
  logs: Pick<PluginLog, 'id' | 'user_id' | 'level' | 'hook' | 'session_id' | 'message' | 'data' | 'error'>[]
): Promise<void> {
  if (logs.length === 0) return;

  // Use batch for efficiency
  const statements = logs.map((log) =>
    db
      .prepare(
        `INSERT INTO plugin_logs (id, user_id, level, hook, session_id, message, data, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        log.id,
        log.user_id,
        log.level,
        log.hook,
        log.session_id,
        log.message,
        log.data,
        log.error
      )
  );

  await db.batch(statements);
}

export async function getPluginLogs(
  db: D1Database,
  teamId: string,
  options: {
    userId?: string;
    level?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ logs: PluginLogWithUser[]; total: number }> {
  const { userId, level, limit = 100, offset = 0 } = options;

  let whereClause = 'WHERE u.team_id = ?';
  const params: unknown[] = [teamId];

  if (userId) {
    whereClause += ' AND pl.user_id = ?';
    params.push(userId);
  }

  if (level) {
    whereClause += ' AND pl.level = ?';
    params.push(level);
  }

  // Get total count
  const countResult = await db
    .prepare(
      `SELECT COUNT(*) as count
       FROM plugin_logs pl
       JOIN users u ON pl.user_id = u.id
       ${whereClause}`
    )
    .bind(...params)
    .first<{ count: number }>();

  const total = countResult?.count ?? 0;

  // Get logs with user info
  const result = await db
    .prepare(
      `SELECT pl.*, u.name as user_name
       FROM plugin_logs pl
       JOIN users u ON pl.user_id = u.id
       ${whereClause}
       ORDER BY pl.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset)
    .all<PluginLogWithUser>();

  return { logs: result.results, total };
}

export async function deleteOldPluginLogs(db: D1Database, daysToKeep: number = 30): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM plugin_logs
       WHERE created_at < datetime('now', '-' || ? || ' days')`
    )
    .bind(daysToKeep)
    .run();

  return result.meta.changes ?? 0;
}

// ============================================================================
// SESSION DETAIL QUERIES
// ============================================================================

export type PaginatedActivities = {
  activities: ParsedActivity[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

/**
 * Get paginated activities for a single session, ordered by newest first.
 */
export async function getSessionActivities(
  db: D1Database,
  sessionId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<PaginatedActivities> {
  const { limit = 50, offset = 0 } = options;

  const countResult = await db
    .prepare('SELECT COUNT(*) as count FROM activity WHERE session_id = ?')
    .bind(sessionId)
    .first<{ count: number }>();

  const total = countResult?.count ?? 0;

  const result = await db
    .prepare(
      `SELECT * FROM activity
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(sessionId, limit, offset)
    .all<Activity>();

  const activities = result.results.map((a) => ({
    ...a,
    files: safeParseFiles(a.files),
  }));

  return {
    activities,
    total,
    limit,
    offset,
    hasMore: offset + activities.length < total,
  };
}

/**
 * Get a single session with full details (user, device, repo, latest activity).
 * Verifies the session belongs to the given team.
 */
export async function getSessionWithDetails(
  db: D1Database,
  sessionId: string,
  teamId: string
): Promise<SessionWithDetails | null> {
  const row = await db
    .prepare(
      `SELECT
        s.*,
        u.id as user_id, u.name as user_name,
        d.id as device_id, d.name as device_name, d.is_remote as device_is_remote,
        r.id as repo_id, r.name as repo_name, r.remote_url as repo_remote_url,
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
      WHERE s.id = ?
      AND u.team_id = ?`
    )
    .bind(sessionId, teamId)
    .first();

  if (!row) return null;

  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    device_id: r.device_id as string,
    repo_id: r.repo_id as string | null,
    branch: r.branch as string | null,
    worktree: r.worktree as string | null,
    status: r.status as 'active' | 'stale' | 'ended',
    started_at: r.started_at as string,
    last_activity_at: r.last_activity_at as string,
    ended_at: r.ended_at as string | null,
    user: {
      id: r.user_id as string,
      name: r.user_name as string,
    },
    device: {
      id: r.device_id as string,
      name: r.device_name as string,
      is_remote: r.device_is_remote as number,
    },
    repo: r.repo_id
      ? {
          id: r.repo_id as string,
          name: r.repo_name as string,
          remote_url: r.repo_remote_url as string | null,
        }
      : null,
    latest_activity: r.activity_id
      ? {
          id: r.activity_id as string,
          session_id: r.id as string,
          files: safeParseFiles(r.files as string),
          semantic_scope: r.semantic_scope as string | null,
          summary: r.summary as string | null,
          created_at: r.activity_created_at as string,
        }
      : null,
  };
}
