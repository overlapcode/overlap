-- ============================================================================
-- OVERLAP DATABASE SCHEMA
-- Version: 1.0.0
-- ============================================================================

-- ============================================================================
-- TEAMS
-- Each deployment is a single team. This table stores team-level settings.
-- ============================================================================
CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    team_token TEXT UNIQUE NOT NULL,
    dashboard_password_hash TEXT,
    is_public INTEGER DEFAULT 0,
    llm_provider TEXT DEFAULT 'heuristic',
    llm_model TEXT,
    llm_api_key_encrypted TEXT,
    stale_timeout_hours INTEGER DEFAULT 8,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- USERS
-- Team members who use Claude Code with the Overlap plugin.
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_token TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    stale_timeout_hours INTEGER,  -- NULL means use team default
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- DEVICES
-- Each user can have multiple devices (laptops, workstations, remotes).
-- ============================================================================
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    hostname TEXT,
    is_remote INTEGER DEFAULT 0,
    last_seen_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, hostname, is_remote)
);

-- ============================================================================
-- REPOS
-- Repositories that team members work on. Auto-registered on first use.
-- ============================================================================
CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    remote_url TEXT,
    repo_token TEXT UNIQUE NOT NULL,
    is_public INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(team_id, remote_url)
);

-- ============================================================================
-- SESSIONS
-- Claude Code sessions. Each session tracks a coding session for a user.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL,
    branch TEXT,
    worktree TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stale', 'ended')),
    started_at TEXT DEFAULT (datetime('now')),
    last_activity_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT
);

-- ============================================================================
-- ACTIVITY
-- Timeline items showing what's being worked on. Each activity is a snapshot.
-- ============================================================================
CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    files TEXT NOT NULL,  -- JSON array of file paths
    semantic_scope TEXT,  -- e.g., 'authentication', 'payments', etc.
    summary TEXT,         -- LLM-generated or heuristic summary
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- MAGIC LINKS
-- Temporary authentication links for web dashboard access.
-- ============================================================================
CREATE TABLE IF NOT EXISTS magic_links (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- WEB SESSIONS
-- Browser sessions for authenticated users on the web dashboard.
-- ============================================================================
CREATE TABLE IF NOT EXISTS web_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);
CREATE INDEX IF NOT EXISTS idx_users_token ON users(user_token);

-- Devices
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- Repos
CREATE INDEX IF NOT EXISTS idx_repos_team ON repos(team_id);
CREATE INDEX IF NOT EXISTS idx_repos_remote ON repos(remote_url);

-- Sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repo_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at DESC);

-- Activity
CREATE INDEX IF NOT EXISTS idx_activity_session ON activity(session_id);
CREATE INDEX IF NOT EXISTS idx_activity_scope ON activity(semantic_scope);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);

-- Magic links
CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at);

-- Web sessions
CREATE INDEX IF NOT EXISTS idx_web_sessions_token ON web_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at);
