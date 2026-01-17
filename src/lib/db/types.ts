// Database entity types matching the D1 schema

export type Team = {
  id: string;
  name: string;
  team_token: string;
  dashboard_password_hash: string | null;
  is_public: number; // SQLite boolean
  llm_provider: string;
  llm_model: string | null;
  llm_api_key_encrypted: string | null;
  stale_timeout_hours: number;
  created_at: string;
  updated_at: string;
};

export type User = {
  id: string;
  team_id: string;
  user_token: string;
  name: string;
  email: string | null;
  role: 'admin' | 'member';
  stale_timeout_hours: number | null;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export type Device = {
  id: string;
  user_id: string;
  name: string;
  hostname: string | null;
  is_remote: number;
  last_seen_at: string | null;
  created_at: string;
};

export type Repo = {
  id: string;
  team_id: string;
  name: string;
  remote_url: string | null;
  repo_token: string;
  is_public: number;
  created_at: string;
};

export type Session = {
  id: string;
  user_id: string;
  device_id: string;
  repo_id: string | null;
  branch: string | null;
  worktree: string | null;
  status: 'active' | 'stale' | 'ended';
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
};

export type Activity = {
  id: string;
  session_id: string;
  files: string; // JSON array
  semantic_scope: string | null;
  summary: string | null;
  created_at: string;
};

export type MagicLink = {
  id: string;
  token: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export type WebSession = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
};

// Parsed activity with files as array
export type ParsedActivity = Omit<Activity, 'files'> & {
  files: string[];
};

// Session with related data for timeline display
export type SessionWithDetails = Session & {
  user: Pick<User, 'id' | 'name'>;
  device: Pick<Device, 'id' | 'name' | 'is_remote'>;
  repo: Pick<Repo, 'id' | 'name'> | null;
  latest_activity: ParsedActivity | null;
};
