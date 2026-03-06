-- ============================================================================
-- OVERLAP DATABASE SCHEMA
-- Current as of v1.7.3
-- ============================================================================
--
-- This file mirrors the SCHEMA constant in src/lib/db/migrate.ts.
-- The auto-migration runs on every deploy, so this file is optional —
-- but useful for manual setup: wrangler d1 execute overlap-db --file=migrations/001_initial.sql
--
-- IMPORTANT: Keep this file in sync with the SCHEMA constant in migrate.ts.
-- ============================================================================

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
    decision TEXT,
    public_id TEXT,
    detected_at TEXT DEFAULT (datetime('now'))
);

-- ACTIVITY_BLOCKS
-- Goal-level groupings within a session. Requires LLM classification.
CREATE TABLE IF NOT EXISTS activity_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    user_id TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    block_index INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    name TEXT,
    description TEXT,
    task_type TEXT,
    confidence REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
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
CREATE INDEX IF NOT EXISTS idx_activity_blocks_session ON activity_blocks(session_id, block_index);

-- Dedup indexes: prevent duplicate events during backfill re-sync
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_ops_dedup ON file_operations(session_id, timestamp, tool_name, file_path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_dedup ON prompts(session_id, turn_number) WHERE turn_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_responses_dedup ON agent_responses(session_id, turn_number, response_type) WHERE turn_number IS NOT NULL;

-- Composite index for real-time overlap query (POST /api/v1/overlap-query)
CREATE INDEX IF NOT EXISTS idx_file_ops_overlap_query ON file_operations(repo_name, file_path, operation, timestamp DESC);

-- Unique index on overlap public_id for UUID lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_overlaps_public_id ON overlaps(public_id) WHERE public_id IS NOT NULL;

-- INSIGHTS
-- Generated insight reports (per user or team, per period).
CREATE TABLE IF NOT EXISTS insights (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'user',
    user_id TEXT REFERENCES members(user_id),
    period_type TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    model_used TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    content TEXT,
    error TEXT,
    generated_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_insights_user ON insights(user_id, period_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_insights_scope ON insights(scope, period_type, period_start DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_dedup ON insights(scope, COALESCE(user_id, '__team__'), period_type, period_start);

-- SESSION_FACETS
-- Per-session LLM analysis (Layer 1 of two-layer insight generation).
-- Each session is analyzed individually; facets are aggregated for period insights.
CREATE TABLE IF NOT EXISTS session_facets (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    user_id TEXT NOT NULL,
    underlying_goal TEXT,
    goal_categories TEXT,
    outcome TEXT,
    session_type TEXT,
    friction_counts TEXT,
    friction_detail TEXT,
    primary_success TEXT,
    brief_summary TEXT,
    model_used TEXT,
    generated_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_facets_session ON session_facets(session_id);
CREATE INDEX IF NOT EXISTS idx_session_facets_user ON session_facets(user_id, generated_at DESC);
