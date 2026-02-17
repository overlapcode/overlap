/**
 * Auto-migration for first-time setup.
 * Checks if database is initialized and creates tables if not.
 *
 * v1.0.0 - JSONL Tracer Architecture
 */

import type { D1Database } from '@cloudflare/workers-types';

const SCHEMA = `
-- SCHEMA_VERSION
-- Tracks database schema version for migrations.
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_version (version) VALUES (1);

-- TEAM_CONFIG
-- Single row (id=1). Stores team-level settings configured during /setup.
CREATE TABLE IF NOT EXISTS team_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    team_name TEXT NOT NULL,
    password_hash TEXT DEFAULT '',
    team_join_code TEXT NOT NULL,
    stale_timeout_hours INTEGER DEFAULT 8,
    llm_provider TEXT,
    llm_model TEXT,
    llm_api_key_encrypted TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- REPOS
-- Repositories registered by admin. Tracer only syncs registered repos.
CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT,
    description TEXT,
    remote_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- MEMBERS
-- Team members. Each gets a unique token for the tracer binary.
CREATE TABLE IF NOT EXISTS members (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT,
    token_hash TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    last_active_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- SESSIONS
-- Coding agent sessions. Created on first ingest, updated throughout.
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES members(user_id),
    repo_id TEXT REFERENCES repos(id),
    repo_name TEXT NOT NULL,
    agent_type TEXT NOT NULL DEFAULT 'claude_code',
    agent_version TEXT,
    cwd TEXT,
    git_branch TEXT,
    model TEXT,
    hostname TEXT,
    device_name TEXT,
    is_remote INTEGER DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    total_cost_usd REAL,
    duration_ms INTEGER,
    num_turns INTEGER DEFAULT 0,
    total_input_tokens INTEGER,
    total_output_tokens INTEGER,
    cache_creation_tokens INTEGER,
    cache_read_tokens INTEGER,
    result_summary TEXT,
    generated_summary TEXT,
    summary_event_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- FILE_OPERATIONS
-- File operations extracted from tool_use messages.
CREATE TABLE IF NOT EXISTS file_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    user_id TEXT NOT NULL,
    repo_id TEXT REFERENCES repos(id),
    repo_name TEXT NOT NULL,
    agent_type TEXT NOT NULL DEFAULT 'claude_code',
    timestamp TEXT NOT NULL,
    tool_name TEXT,
    file_path TEXT,
    operation TEXT,
    start_line INTEGER,
    end_line INTEGER,
    function_name TEXT,
    bash_command TEXT,
    old_string TEXT,
    new_string TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- PROMPTS
-- User prompts extracted from user messages.
CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    user_id TEXT NOT NULL,
    repo_id TEXT REFERENCES repos(id),
    repo_name TEXT NOT NULL,
    agent_type TEXT NOT NULL DEFAULT 'claude_code',
    timestamp TEXT NOT NULL,
    prompt_text TEXT,
    turn_number INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

-- AGENT_RESPONSES
-- Agent text and thinking responses extracted from assistant messages.
CREATE TABLE IF NOT EXISTS agent_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    user_id TEXT NOT NULL,
    repo_id TEXT REFERENCES repos(id),
    repo_name TEXT NOT NULL,
    agent_type TEXT NOT NULL DEFAULT 'claude_code',
    timestamp TEXT NOT NULL,
    response_text TEXT,
    response_type TEXT DEFAULT 'text',
    turn_number INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

-- OVERLAPS
-- Detected overlaps (file-level, prompt-level, directory-level).
CREATE TABLE IF NOT EXISTS overlaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'info',
    overlap_scope TEXT DEFAULT 'file',
    file_path TEXT,
    directory_path TEXT,
    start_line INTEGER,
    end_line INTEGER,
    function_name TEXT,
    repo_name TEXT NOT NULL,
    user_id_a TEXT NOT NULL,
    user_id_b TEXT NOT NULL,
    session_id_a TEXT,
    session_id_b TEXT,
    description TEXT,
    detected_at TEXT DEFAULT (datetime('now'))
);

-- WEB_SESSIONS
-- Browser sessions for authenticated dashboard access.
CREATE TABLE IF NOT EXISTS web_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    user_id TEXT REFERENCES members(user_id),
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repo_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_ops_path ON file_operations(file_path, repo_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_file_ops_session ON file_operations(session_id);
CREATE INDEX IF NOT EXISTS idx_file_ops_user_time ON file_operations(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_file_ops_repo_time ON file_operations(repo_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_prompts_repo ON prompts(repo_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agent_responses_session ON agent_responses(session_id, turn_number, timestamp);
CREATE INDEX IF NOT EXISTS idx_overlaps_time ON overlaps(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_overlaps_repo ON overlaps(repo_name, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_token ON members(token_hash);
CREATE INDEX IF NOT EXISTS idx_members_last_active ON members(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_sessions_token ON web_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at);
`;

/**
 * Migrations for existing databases.
 * Each runs in a try/catch so it's safe to re-run (idempotent).
 */
const MIGRATIONS = [
  // v1.2.0: Add user_id to web_sessions (auth redesign: token-based login)
  `ALTER TABLE web_sessions ADD COLUMN user_id TEXT REFERENCES members(user_id)`,
  // v1.4.3: Add remote_url to repos (for VCS file links)
  `ALTER TABLE repos ADD COLUMN remote_url TEXT`,
  // v1.5.0: Add old_string/new_string to file_operations (edit content capture)
  `ALTER TABLE file_operations ADD COLUMN old_string TEXT`,
  `ALTER TABLE file_operations ADD COLUMN new_string TEXT`,
];

export async function ensureMigrated(db: D1Database): Promise<void> {
  // Always run CREATE TABLE IF NOT EXISTS statements - they're idempotent
  // This ensures new tables are created even for existing deployments
  const statements = SCHEMA
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    try {
      await db.prepare(statement).run();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('already exists')) {
        console.error('Migration error:', msg, 'Statement:', statement.substring(0, 80));
      }
    }
  }

  // Run ALTER TABLE migrations for existing databases
  for (const migration of MIGRATIONS) {
    try {
      await db.prepare(migration).run();
    } catch (error) {
      // Expected to fail if column already exists (fresh installs) — ignore
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('duplicate column') && !msg.includes('already exists')) {
        console.error('Migration error:', msg);
      }
    }
  }
}
