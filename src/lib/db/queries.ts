import type { D1Database } from '@cloudflare/workers-types';
import type {
  TeamConfig,
  Repo,
  Member,
  Session,
  FileOperation,
  Prompt,
  Overlap,
  WebSession,
  SessionWithMember,
  SessionDetail,
  TeamStats,
  OverlapWithMembers,
  IngestEvent,
} from './types';

// ============================================================================
// TEAM CONFIG QUERIES
// ============================================================================

export async function getTeamConfig(db: D1Database): Promise<TeamConfig | null> {
  return db.prepare('SELECT * FROM team_config WHERE id = 1').first<TeamConfig>();
}

export async function createTeamConfig(
  db: D1Database,
  data: Pick<TeamConfig, 'team_name' | 'password_hash' | 'team_join_code'>
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO team_config (id, team_name, password_hash, team_join_code)
       VALUES (1, ?, ?, ?)`
    )
    .bind(data.team_name, data.password_hash, data.team_join_code)
    .run();
}

export async function updateTeamConfig(
  db: D1Database,
  settings: Partial<Omit<TeamConfig, 'id' | 'created_at'>>
): Promise<void> {
  const updates: string[] = [];
  const values: unknown[] = [];

  if (settings.team_name !== undefined) {
    updates.push('team_name = ?');
    values.push(settings.team_name);
  }
  if (settings.password_hash !== undefined) {
    updates.push('password_hash = ?');
    values.push(settings.password_hash);
  }
  if (settings.team_join_code !== undefined) {
    updates.push('team_join_code = ?');
    values.push(settings.team_join_code);
  }
  if (settings.stale_timeout_hours !== undefined) {
    updates.push('stale_timeout_hours = ?');
    values.push(settings.stale_timeout_hours);
  }
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

  if (updates.length === 0) return;

  await db
    .prepare(`UPDATE team_config SET ${updates.join(', ')} WHERE id = 1`)
    .bind(...values)
    .run();
}

// ============================================================================
// REPO QUERIES
// ============================================================================

export async function getRepoById(db: D1Database, id: string): Promise<Repo | null> {
  return db.prepare('SELECT * FROM repos WHERE id = ?').bind(id).first<Repo>();
}

export async function getRepoByName(db: D1Database, name: string): Promise<Repo | null> {
  return db.prepare('SELECT * FROM repos WHERE name = ?').bind(name).first<Repo>();
}

export async function getAllRepos(db: D1Database): Promise<Repo[]> {
  const result = await db.prepare('SELECT * FROM repos ORDER BY name').all<Repo>();
  return result.results;
}

export async function createRepo(
  db: D1Database,
  data: Pick<Repo, 'id' | 'name'> & Partial<Pick<Repo, 'display_name' | 'description'>>
): Promise<Repo> {
  await db
    .prepare(
      `INSERT INTO repos (id, name, display_name, description)
       VALUES (?, ?, ?, ?)`
    )
    .bind(data.id, data.name, data.display_name ?? null, data.description ?? null)
    .run();

  return db.prepare('SELECT * FROM repos WHERE id = ?').bind(data.id).first<Repo>() as Promise<Repo>;
}

export async function updateRepo(
  db: D1Database,
  id: string,
  updates: Partial<Pick<Repo, 'name' | 'display_name' | 'description'>>
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.display_name);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }

  if (fields.length === 0) return;

  values.push(id);
  await db.prepare(`UPDATE repos SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteRepo(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM repos WHERE id = ?').bind(id).run();
}

// ============================================================================
// MEMBER QUERIES
// ============================================================================

export async function getMemberById(db: D1Database, userId: string): Promise<Member | null> {
  return db.prepare('SELECT * FROM members WHERE user_id = ?').bind(userId).first<Member>();
}

export async function getMemberByTokenHash(db: D1Database, tokenHash: string): Promise<Member | null> {
  return db.prepare('SELECT * FROM members WHERE token_hash = ?').bind(tokenHash).first<Member>();
}

export async function getAllMembers(db: D1Database): Promise<Member[]> {
  const result = await db.prepare('SELECT * FROM members ORDER BY display_name').all<Member>();
  return result.results;
}

export async function createMember(
  db: D1Database,
  data: Pick<Member, 'user_id' | 'display_name' | 'token_hash' | 'role'> & Partial<Pick<Member, 'email'>>
): Promise<Member> {
  await db
    .prepare(
      `INSERT INTO members (user_id, display_name, email, token_hash, role)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(data.user_id, data.display_name, data.email ?? null, data.token_hash, data.role)
    .run();

  return db.prepare('SELECT * FROM members WHERE user_id = ?').bind(data.user_id).first<Member>() as Promise<Member>;
}

export async function updateMember(
  db: D1Database,
  userId: string,
  updates: Partial<Pick<Member, 'display_name' | 'email' | 'role' | 'token_hash'>>
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.display_name);
  }
  if (updates.email !== undefined) {
    fields.push('email = ?');
    values.push(updates.email);
  }
  if (updates.role !== undefined) {
    fields.push('role = ?');
    values.push(updates.role);
  }
  if (updates.token_hash !== undefined) {
    fields.push('token_hash = ?');
    values.push(updates.token_hash);
  }

  if (fields.length === 0) return;

  values.push(userId);
  await db.prepare(`UPDATE members SET ${fields.join(', ')} WHERE user_id = ?`).bind(...values).run();
}

export async function updateMemberLastActive(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("UPDATE members SET last_active_at = datetime('now') WHERE user_id = ?")
    .bind(userId)
    .run();
}

export async function deleteMember(db: D1Database, userId: string): Promise<void> {
  // Delete related data first (foreign key constraints)
  await db.batch([
    db.prepare('DELETE FROM prompts WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM file_operations WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM members WHERE user_id = ?').bind(userId),
  ]);
}

// ============================================================================
// SESSION QUERIES
// ============================================================================

export async function getSessionById(db: D1Database, id: string): Promise<Session | null> {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<Session>();
}

export async function createSession(db: D1Database, event: IngestEvent): Promise<Session> {
  // Look up repo_id by name
  const repo = await getRepoByName(db, event.repo_name);

  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, repo_id, repo_name, agent_type, agent_version, cwd, git_branch, model, hostname, device_name, is_remote, started_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    )
    .bind(
      event.session_id,
      event.user_id,
      repo?.id ?? null,
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
    .run();

  return db.prepare('SELECT * FROM sessions WHERE id = ?').bind(event.session_id).first<Session>() as Promise<Session>;
}

export async function updateSessionOnEnd(db: D1Database, event: IngestEvent): Promise<void> {
  await db
    .prepare(
      `UPDATE sessions SET
        status = 'ended',
        ended_at = ?,
        total_cost_usd = ?,
        duration_ms = ?,
        num_turns = COALESCE(?, num_turns),
        total_input_tokens = ?,
        total_output_tokens = ?,
        cache_creation_tokens = ?,
        cache_read_tokens = ?,
        result_summary = ?
       WHERE id = ?`
    )
    .bind(
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
    .run();
}

export async function updateSessionSummary(db: D1Database, sessionId: string, summary: string): Promise<void> {
  await db
    .prepare(
      `UPDATE sessions SET generated_summary = ?, summary_event_count = 0 WHERE id = ?`
    )
    .bind(summary, sessionId)
    .run();
}

export async function incrementSessionEventCount(db: D1Database, sessionId: string): Promise<number> {
  await db
    .prepare(`UPDATE sessions SET summary_event_count = summary_event_count + 1 WHERE id = ?`)
    .bind(sessionId)
    .run();

  const session = await db
    .prepare('SELECT summary_event_count FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ summary_event_count: number }>();

  return session?.summary_event_count ?? 0;
}

export async function reactivateSession(db: D1Database, sessionId: string): Promise<void> {
  await db
    .prepare(`UPDATE sessions SET status = 'active', ended_at = NULL WHERE id = ?`)
    .bind(sessionId)
    .run();
}

// ============================================================================
// SESSION LIST QUERIES
// ============================================================================

export type SessionListOptions = {
  limit?: number;
  offset?: number;
  userId?: string;
  repoName?: string;
  status?: 'active' | 'stale' | 'ended' | 'active_or_stale' | 'all';
  startDate?: string;
  endDate?: string;
};

export type PaginatedSessions = {
  sessions: SessionWithMember[];
  total: number;
  hasMore: boolean;
};

export async function getSessions(db: D1Database, options: SessionListOptions = {}): Promise<PaginatedSessions> {
  const { limit = 20, offset = 0, userId, repoName, status = 'active_or_stale', startDate, endDate } = options;

  let whereClause = 'WHERE 1=1';
  const params: unknown[] = [];

  if (userId) {
    whereClause += ' AND s.user_id = ?';
    params.push(userId);
  }
  if (repoName) {
    whereClause += ' AND s.repo_name = ?';
    params.push(repoName);
  }
  if (status === 'all') {
    // No status filter — include all sessions
  } else if (status === 'active_or_stale') {
    whereClause += " AND s.status IN ('active', 'stale')";
  } else {
    whereClause += ' AND s.status = ?';
    params.push(status);
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
    .prepare(`SELECT COUNT(*) as count FROM sessions s ${whereClause}`)
    .bind(...params)
    .first<{ count: number }>();
  const total = countResult?.count ?? 0;

  // Get sessions with member and repo
  const result = await db
    .prepare(
      `SELECT s.*, m.display_name as member_name, r.id as r_id, r.name as r_name, r.display_name as r_display_name,
              COALESCE(
                (SELECT MAX(timestamp) FROM file_operations WHERE session_id = s.id),
                (SELECT MAX(timestamp) FROM prompts WHERE session_id = s.id),
                s.started_at
              ) as last_activity_at
       FROM sessions s
       JOIN members m ON s.user_id = m.user_id
       LEFT JOIN repos r ON s.repo_id = r.id
       ${whereClause}
       ORDER BY s.started_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset)
    .all();

  const sessions = result.results.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    user_id: row.user_id as string,
    repo_id: row.repo_id as string | null,
    repo_name: row.repo_name as string,
    agent_type: (row.agent_type as string) || 'claude_code',
    agent_version: row.agent_version as string | null,
    cwd: row.cwd as string | null,
    git_branch: row.git_branch as string | null,
    model: row.model as string | null,
    hostname: row.hostname as string | null,
    device_name: row.device_name as string | null,
    is_remote: Boolean(row.is_remote),
    started_at: row.started_at as string,
    ended_at: row.ended_at as string | null,
    total_cost_usd: row.total_cost_usd as number | null,
    duration_ms: row.duration_ms as number | null,
    num_turns: row.num_turns as number,
    total_input_tokens: row.total_input_tokens as number | null,
    total_output_tokens: row.total_output_tokens as number | null,
    cache_creation_tokens: row.cache_creation_tokens as number | null,
    cache_read_tokens: row.cache_read_tokens as number | null,
    result_summary: row.result_summary as string | null,
    generated_summary: row.generated_summary as string | null,
    summary_event_count: row.summary_event_count as number,
    status: row.status as 'active' | 'ended' | 'stale',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    member: {
      user_id: row.user_id as string,
      display_name: row.member_name as string,
    },
    repo: row.r_id
      ? {
          id: row.r_id as string,
          name: row.r_name as string,
          display_name: row.r_display_name as string | null,
        }
      : null,
    last_activity_at: row.last_activity_at as string,
  }));

  return { sessions, total, hasMore: offset + sessions.length < total };
}

export async function getSessionDetail(db: D1Database, sessionId: string): Promise<SessionDetail | null> {
  const session = await db
    .prepare(
      `SELECT s.*, m.display_name as member_name, r.id as r_id, r.name as r_name, r.display_name as r_display_name
       FROM sessions s
       JOIN members m ON s.user_id = m.user_id
       LEFT JOIN repos r ON s.repo_id = r.id
       WHERE s.id = ?`
    )
    .bind(sessionId)
    .first();

  if (!session) return null;

  const row = session as Record<string, unknown>;

  // Get file operations
  const fileOpsResult = await db
    .prepare('SELECT * FROM file_operations WHERE session_id = ? ORDER BY timestamp')
    .bind(sessionId)
    .all<FileOperation>();

  // Get prompts
  const promptsResult = await db
    .prepare('SELECT * FROM prompts WHERE session_id = ? ORDER BY turn_number, timestamp')
    .bind(sessionId)
    .all<Prompt>();

  return {
    id: row.id as string,
    user_id: row.user_id as string,
    repo_id: row.repo_id as string | null,
    repo_name: row.repo_name as string,
    agent_type: (row.agent_type as string) || 'claude_code',
    agent_version: row.agent_version as string | null,
    cwd: row.cwd as string | null,
    git_branch: row.git_branch as string | null,
    model: row.model as string | null,
    hostname: row.hostname as string | null,
    device_name: row.device_name as string | null,
    is_remote: Boolean(row.is_remote),
    started_at: row.started_at as string,
    ended_at: row.ended_at as string | null,
    total_cost_usd: row.total_cost_usd as number | null,
    duration_ms: row.duration_ms as number | null,
    num_turns: row.num_turns as number,
    total_input_tokens: row.total_input_tokens as number | null,
    total_output_tokens: row.total_output_tokens as number | null,
    cache_creation_tokens: row.cache_creation_tokens as number | null,
    cache_read_tokens: row.cache_read_tokens as number | null,
    result_summary: row.result_summary as string | null,
    generated_summary: row.generated_summary as string | null,
    summary_event_count: row.summary_event_count as number,
    status: row.status as 'active' | 'ended' | 'stale',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    member: {
      user_id: row.user_id as string,
      display_name: row.member_name as string,
    },
    repo: row.r_id
      ? {
          id: row.r_id as string,
          name: row.r_name as string,
          display_name: row.r_display_name as string | null,
        }
      : null,
    file_operations: fileOpsResult.results,
    prompts: promptsResult.results,
  };
}

// ============================================================================
// FILE OPERATION QUERIES
// ============================================================================

export async function createFileOperation(db: D1Database, event: IngestEvent): Promise<void> {
  const repo = await getRepoByName(db, event.repo_name);

  await db
    .prepare(
      `INSERT INTO file_operations (session_id, user_id, repo_id, repo_name, agent_type, timestamp, tool_name, file_path, operation, start_line, end_line, function_name, bash_command)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      event.session_id,
      event.user_id,
      repo?.id ?? null,
      event.repo_name,
      event.agent_type,
      event.timestamp,
      event.tool_name ?? null,
      event.file_path ?? null,
      event.operation ?? null,
      event.start_line ?? null,
      event.end_line ?? null,
      event.function_name ?? null,
      event.bash_command ?? null
    )
    .run();
}

export async function getFileActivity(
  db: D1Database,
  filePath: string,
  repoName: string,
  options: { limit?: number; days?: number } = {}
): Promise<{
  operations: Array<FileOperation & { display_name: string; git_branch: string | null }>;
  sessions_count: number;
  users_count: number;
}> {
  const { limit = 50, days = 7 } = options;

  const result = await db
    .prepare(
      `SELECT fo.*, m.display_name, s.git_branch
       FROM file_operations fo
       JOIN members m ON fo.user_id = m.user_id
       JOIN sessions s ON fo.session_id = s.id
       WHERE fo.file_path = ? AND fo.repo_name = ?
       AND fo.timestamp > datetime('now', '-' || ? || ' days')
       ORDER BY fo.timestamp DESC
       LIMIT ?`
    )
    .bind(filePath, repoName, days, limit)
    .all();

  const statsResult = await db
    .prepare(
      `SELECT COUNT(DISTINCT session_id) as sessions_count, COUNT(DISTINCT user_id) as users_count
       FROM file_operations
       WHERE file_path = ? AND repo_name = ?
       AND timestamp > datetime('now', '-' || ? || ' days')`
    )
    .bind(filePath, repoName, days)
    .first<{ sessions_count: number; users_count: number }>();

  return {
    operations: result.results as Array<FileOperation & { display_name: string; git_branch: string | null }>,
    sessions_count: statsResult?.sessions_count ?? 0,
    users_count: statsResult?.users_count ?? 0,
  };
}

// ============================================================================
// PROMPT QUERIES
// ============================================================================

export async function createPrompt(db: D1Database, event: IngestEvent): Promise<void> {
  const repo = await getRepoByName(db, event.repo_name);

  await db
    .prepare(
      `INSERT INTO prompts (session_id, user_id, repo_id, repo_name, agent_type, timestamp, prompt_text, turn_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      event.session_id,
      event.user_id,
      repo?.id ?? null,
      event.repo_name,
      event.agent_type,
      event.timestamp,
      event.prompt_text ?? null,
      event.turn_number ?? null
    )
    .run();
}

export async function getSessionPrompts(db: D1Database, sessionId: string): Promise<Prompt[]> {
  const result = await db
    .prepare('SELECT * FROM prompts WHERE session_id = ? ORDER BY turn_number, timestamp')
    .bind(sessionId)
    .all<Prompt>();
  return result.results;
}

// ============================================================================
// OVERLAP QUERIES
// ============================================================================

export async function createOverlap(db: D1Database, overlap: Omit<Overlap, 'id' | 'detected_at'>): Promise<void> {
  await db
    .prepare(
      `INSERT INTO overlaps (type, severity, overlap_scope, file_path, directory_path, start_line, end_line, function_name, repo_name, user_id_a, user_id_b, session_id_a, session_id_b, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      overlap.type,
      overlap.severity,
      overlap.overlap_scope ?? 'file',
      overlap.file_path ?? null,
      overlap.directory_path ?? null,
      overlap.start_line ?? null,
      overlap.end_line ?? null,
      overlap.function_name ?? null,
      overlap.repo_name,
      overlap.user_id_a,
      overlap.user_id_b,
      overlap.session_id_a ?? null,
      overlap.session_id_b ?? null,
      overlap.description ?? null
    )
    .run();
}

export async function getOverlaps(
  db: D1Database,
  options: { repoName?: string; limit?: number; days?: number } = {}
): Promise<OverlapWithMembers[]> {
  const { repoName, limit = 50, days = 7 } = options;

  let query = `
    SELECT o.*, ma.display_name as member_a_name, mb.display_name as member_b_name
    FROM overlaps o
    JOIN members ma ON o.user_id_a = ma.user_id
    JOIN members mb ON o.user_id_b = mb.user_id
    WHERE o.detected_at > datetime('now', '-' || ? || ' days')
  `;
  const params: unknown[] = [days];

  if (repoName) {
    query += ' AND o.repo_name = ?';
    params.push(repoName);
  }

  query += ' ORDER BY o.detected_at DESC LIMIT ?';
  params.push(limit);

  const result = await db.prepare(query).bind(...params).all<OverlapWithMembers>();
  return result.results;
}

/**
 * Detect file overlaps with line/function granularity.
 * Tiers: line overlap (high) > function overlap (high) > file overlap (warning).
 * Called after processing file_op events.
 */
export async function detectFileOverlaps(db: D1Database, repoName: string): Promise<void> {
  // Find file overlaps within last 24 hours, including line data
  const overlapsResult = await db
    .prepare(
      `SELECT fo1.user_id AS user_a, fo2.user_id AS user_b,
              fo1.file_path, fo1.repo_name,
              fo1.session_id AS session_a, fo2.session_id AS session_b,
              fo1.start_line AS start_a, fo1.end_line AS end_a,
              fo2.start_line AS start_b, fo2.end_line AS end_b,
              fo1.function_name AS fn_a, fo2.function_name AS fn_b
       FROM file_operations fo1
       JOIN file_operations fo2 ON fo1.file_path = fo2.file_path
         AND fo1.repo_name = fo2.repo_name
         AND fo1.user_id != fo2.user_id
         AND fo1.operation IN ('create', 'modify')
         AND fo2.operation IN ('create', 'modify')
         AND abs(julianday(fo1.timestamp) - julianday(fo2.timestamp)) < (2.0/24.0)
       WHERE fo1.repo_name = ?
       AND fo1.timestamp > datetime('now', '-24 hours')
       AND fo1.id < fo2.id`
    )
    .bind(repoName)
    .all();

  for (const row of overlapsResult.results) {
    const r = row as Record<string, unknown>;
    const startA = r.start_a as number | null;
    const endA = r.end_a as number | null;
    const startB = r.start_b as number | null;
    const endB = r.end_b as number | null;
    const fnA = r.fn_a as string | null;
    const fnB = r.fn_b as string | null;

    // Determine overlap scope and severity
    let overlapScope: 'line' | 'function' | 'file' = 'file';
    let severity: 'high' | 'warning' = 'warning';
    let description = `Both users modified ${r.file_path} within 2 hours`;

    // Check for line-level overlap (ranges intersect)
    if (startA != null && endA != null && startB != null && endB != null) {
      if (startA <= endB && endA >= startB) {
        overlapScope = 'line';
        severity = 'high';
        description = `Both users modified overlapping lines (${startA}-${endA} vs ${startB}-${endB}) in ${r.file_path}`;
      }
    }

    // Check for function-level overlap (same function name)
    if (overlapScope === 'file' && fnA && fnB && fnA === fnB) {
      overlapScope = 'function';
      severity = 'high';
      description = `Both users modified ${fnA}() in ${r.file_path}`;
    }

    // Check if this overlap already exists (scope-aware dedup)
    const existing = await db
      .prepare(
        `SELECT id FROM overlaps
         WHERE type = 'file' AND file_path = ? AND repo_name = ? AND overlap_scope = ?
         AND ((user_id_a = ? AND user_id_b = ?) OR (user_id_a = ? AND user_id_b = ?))
         AND detected_at > datetime('now', '-24 hours')`
      )
      .bind(r.file_path, r.repo_name, overlapScope, r.user_a, r.user_b, r.user_b, r.user_a)
      .first();

    if (!existing) {
      await createOverlap(db, {
        type: 'file',
        severity,
        overlap_scope: overlapScope,
        file_path: r.file_path as string,
        directory_path: null,
        start_line: startA,
        end_line: endA,
        function_name: fnA || fnB || null,
        repo_name: r.repo_name as string,
        user_id_a: r.user_a as string,
        user_id_b: r.user_b as string,
        session_id_a: r.session_a as string,
        session_id_b: r.session_b as string,
        description,
      });
    }
  }
}

/**
 * Get active sessions with file regions for team-state endpoint.
 */
export async function getActiveSessionsWithRegions(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db
    .prepare(
      `SELECT
          s.id AS session_id,
          s.user_id,
          m.display_name,
          s.repo_name,
          s.started_at,
          s.generated_summary AS summary,
          s.status,
          fo.file_path,
          fo.start_line,
          fo.end_line,
          fo.function_name,
          MAX(fo.timestamp) AS last_touched_at
       FROM sessions s
       JOIN members m ON s.user_id = m.user_id
       LEFT JOIN file_operations fo ON fo.session_id = s.id
         AND fo.operation IN ('create', 'modify')
       WHERE s.status = 'active'
       GROUP BY s.id, s.user_id, m.display_name, s.repo_name, s.started_at,
                s.generated_summary, s.status, fo.file_path, fo.start_line,
                fo.end_line, fo.function_name
       ORDER BY MAX(fo.timestamp) DESC`
    )
    .all();

  return result.results;
}

// ============================================================================
// STATS QUERIES
// ============================================================================

export async function getTeamStats(
  db: D1Database,
  options: { startDate?: string; endDate?: string } = {}
): Promise<TeamStats> {
  const { startDate, endDate } = options;

  // Build separate date filters: one for sessions-only queries, one for JOIN queries
  let sessionDateFilter = '';
  let joinDateFilter = '';
  const params: unknown[] = [];

  if (startDate) {
    sessionDateFilter += ' AND started_at >= ?';
    joinDateFilter += ' AND s.started_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    sessionDateFilter += ' AND started_at <= ?';
    joinDateFilter += ' AND s.started_at <= ?';
    params.push(endDate + 'T23:59:59');
  }

  // Basic stats (sessions only)
  const basicStats = await db
    .prepare(
      `SELECT
        COUNT(*) as total_sessions,
        COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
        COALESCE(AVG(duration_ms), 0) as avg_duration_ms
       FROM sessions
       WHERE 1=1 ${sessionDateFilter}`
    )
    .bind(...params)
    .first<{ total_sessions: number; total_cost_usd: number; avg_duration_ms: number }>();

  // Total unique files (JOIN query)
  const filesStats = await db
    .prepare(
      `SELECT COUNT(DISTINCT fo.file_path) as total_files
       FROM file_operations fo
       JOIN sessions s ON fo.session_id = s.id
       WHERE 1=1 ${joinDateFilter}`
    )
    .bind(...params)
    .first<{ total_files: number }>();

  // By member (JOIN query)
  const byMemberResult = await db
    .prepare(
      `SELECT s.user_id, m.display_name, COUNT(*) as session_count, COALESCE(SUM(s.total_cost_usd), 0) as total_cost
       FROM sessions s
       JOIN members m ON s.user_id = m.user_id
       WHERE 1=1 ${joinDateFilter}
       GROUP BY s.user_id, m.display_name
       ORDER BY session_count DESC`
    )
    .bind(...params)
    .all();

  // By repo (sessions only)
  const byRepoResult = await db
    .prepare(
      `SELECT repo_name, COUNT(*) as session_count, COALESCE(SUM(total_cost_usd), 0) as total_cost
       FROM sessions
       WHERE 1=1 ${sessionDateFilter}
       GROUP BY repo_name
       ORDER BY session_count DESC`
    )
    .bind(...params)
    .all();

  // By model (sessions only)
  const byModelResult = await db
    .prepare(
      `SELECT COALESCE(model, 'unknown') as model, COUNT(*) as session_count, COALESCE(SUM(total_cost_usd), 0) as total_cost
       FROM sessions
       WHERE 1=1 ${sessionDateFilter}
       GROUP BY model
       ORDER BY session_count DESC`
    )
    .bind(...params)
    .all();

  // Hottest files (JOIN query)
  const hottestFilesResult = await db
    .prepare(
      `SELECT fo.file_path, COUNT(DISTINCT fo.session_id) as session_count, COUNT(DISTINCT fo.user_id) as user_count
       FROM file_operations fo
       JOIN sessions s ON fo.session_id = s.id
       WHERE fo.operation IN ('create', 'modify')
       ${joinDateFilter}
       GROUP BY fo.file_path
       ORDER BY session_count DESC
       LIMIT 10`
    )
    .bind(...params)
    .all();

  return {
    total_sessions: basicStats?.total_sessions ?? 0,
    total_cost_usd: basicStats?.total_cost_usd ?? 0,
    total_files: filesStats?.total_files ?? 0,
    avg_duration_ms: basicStats?.avg_duration_ms ?? 0,
    by_member: byMemberResult.results.map((r: Record<string, unknown>) => ({
      user_id: r.user_id as string,
      display_name: r.display_name as string,
      session_count: r.session_count as number,
      total_cost: r.total_cost as number,
    })),
    by_repo: byRepoResult.results.map((r: Record<string, unknown>) => ({
      repo_name: r.repo_name as string,
      session_count: r.session_count as number,
      total_cost: r.total_cost as number,
    })),
    by_model: byModelResult.results.map((r: Record<string, unknown>) => ({
      model: r.model as string,
      session_count: r.session_count as number,
      total_cost: r.total_cost as number,
    })),
    hottest_files: hottestFilesResult.results.map((r: Record<string, unknown>) => ({
      file_path: r.file_path as string,
      session_count: r.session_count as number,
      user_count: r.user_count as number,
    })),
  };
}

// ============================================================================
// STALE SESSION HANDLING
// ============================================================================

export async function markStaleSessions(db: D1Database): Promise<number> {
  const config = await getTeamConfig(db);
  const timeout = config?.stale_timeout_hours ?? 8;

  // Get the most recent file operation timestamp for each active session
  const result = await db
    .prepare(
      `UPDATE sessions
       SET status = 'stale'
       WHERE status = 'active'
       AND id NOT IN (
         SELECT DISTINCT session_id FROM file_operations
         WHERE timestamp > datetime('now', '-' || ? || ' hours')
       )
       AND started_at < datetime('now', '-' || ? || ' hours')`
    )
    .bind(timeout, timeout)
    .run();

  return result.meta.changes ?? 0;
}

// ============================================================================
// WEB SESSION QUERIES
// ============================================================================

export async function createWebSession(db: D1Database, id: string, tokenHash: string, expiresAt: string, userId: string): Promise<void> {
  await db
    .prepare('INSERT INTO web_sessions (id, token_hash, user_id, expires_at) VALUES (?, ?, ?, ?)')
    .bind(id, tokenHash, userId, expiresAt)
    .run();
}

export async function getWebSessionByTokenHash(db: D1Database, tokenHash: string): Promise<WebSession | null> {
  return db
    .prepare("SELECT * FROM web_sessions WHERE token_hash = ? AND expires_at > datetime('now')")
    .bind(tokenHash)
    .first<WebSession>();
}

export async function deleteExpiredWebSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM web_sessions WHERE expires_at < datetime('now')").run();
}
