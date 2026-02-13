-- ============================================================================
-- OVERLAP DATABASE SCHEMA v1.0.0
-- JSONL Tracer Architecture
-- ============================================================================
--
-- This is the initial schema for Overlap v1.0.0, which uses a tracer binary
-- to parse coding agent session files and sync to the server.
--
-- Run with: wrangler d1 execute overlap-db --file=migrations/001_initial.sql
-- ============================================================================

-- ============================================================================
-- SCHEMA_VERSION
-- Tracks database schema version for future migrations.
-- ============================================================================
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_version (version) VALUES (1);

-- ============================================================================
-- TEAM_CONFIG
-- Single row (id=1). Stores team-level settings configured during /setup.
-- ============================================================================
CREATE TABLE IF NOT EXISTS team_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    team_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    team_join_code TEXT NOT NULL,
    stale_timeout_hours INTEGER DEFAULT 8,
    llm_provider TEXT,
    llm_model TEXT,
    llm_api_key_encrypted TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- REPOS
-- Repositories registered by admin. Tracer only syncs registered repos.
-- ============================================================================
CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- MEMBERS
-- Team members. Each gets a unique token for the tracer binary.
-- ============================================================================
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

-- ============================================================================
-- SESSIONS
-- Coding agent sessions from JSONL ingestion.
-- ============================================================================
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

-- ============================================================================
-- FILE_OPERATIONS
-- File operations extracted from tool_use messages.
-- ============================================================================
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
    bash_command TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- PROMPTS
-- User prompts extracted from user messages.
-- ============================================================================
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

-- ============================================================================
-- OVERLAPS
-- Detected overlaps (file-level, prompt-level, directory-level).
-- ============================================================================
CREATE TABLE IF NOT EXISTS overlaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'info',
    file_path TEXT,
    directory_path TEXT,
    repo_name TEXT NOT NULL,
    user_id_a TEXT NOT NULL,
    user_id_b TEXT NOT NULL,
    session_id_a TEXT,
    session_id_b TEXT,
    description TEXT,
    detected_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- WEB_SESSIONS
-- Browser sessions for authenticated dashboard access.
-- ============================================================================
CREATE TABLE IF NOT EXISTS web_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repo_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_ops_path ON file_operations(file_path, repo_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_file_ops_session ON file_operations(session_id);
CREATE INDEX IF NOT EXISTS idx_file_ops_user_time ON file_operations(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_file_ops_repo_time ON file_operations(repo_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_prompts_repo ON prompts(repo_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_overlaps_time ON overlaps(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_overlaps_repo ON overlaps(repo_name, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_token ON members(token_hash);
CREATE INDEX IF NOT EXISTS idx_members_last_active ON members(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_sessions_token ON web_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at);
