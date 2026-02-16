// Database entity types matching the v1.0.0 D1 schema
// JSONL Tracer Architecture

// ============================================================================
// TEAM CONFIG
// Single row (id=1), stores team-level settings
// ============================================================================
export type TeamConfig = {
  id: 1;
  team_name: string;
  password_hash: string | null;
  team_join_code: string;
  stale_timeout_hours: number;
  llm_provider: 'heuristic' | 'anthropic' | 'openai' | 'xai' | 'google' | null;
  llm_model: string | null;
  llm_api_key_encrypted: string | null;
  created_at: string;
};

// ============================================================================
// REPOS
// Registered by admin. Tracer only syncs registered repos.
// ============================================================================
export type Repo = {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  created_at: string;
};

// ============================================================================
// MEMBERS
// Team members with unique tokens for tracer binary
// ============================================================================
export type Member = {
  user_id: string;
  display_name: string;
  email: string | null;
  token_hash: string;
  role: 'admin' | 'member';
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// SESSIONS
// Coding agent sessions from JSONL ingestion
// ============================================================================
export type Session = {
  id: string;
  user_id: string;
  repo_id: string | null;
  repo_name: string;
  agent_type: string;
  agent_version: string | null;
  cwd: string | null;
  git_branch: string | null;
  model: string | null;
  hostname: string | null;
  device_name: string | null;
  is_remote: boolean;
  started_at: string;
  ended_at: string | null;
  total_cost_usd: number | null;
  duration_ms: number | null;
  num_turns: number;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  result_summary: string | null;
  generated_summary: string | null;
  summary_event_count: number;
  status: 'active' | 'ended' | 'stale';
  created_at: string;
  updated_at: string;
};

// ============================================================================
// FILE OPERATIONS
// Extracted from tool_use messages
// ============================================================================
export type FileOperation = {
  id: number;
  session_id: string;
  user_id: string;
  repo_id: string | null;
  repo_name: string;
  agent_type: string;
  timestamp: string;
  tool_name: string | null;
  file_path: string | null;
  operation: 'create' | 'modify' | 'read' | 'delete' | 'execute' | 'search' | null;
  start_line: number | null;
  end_line: number | null;
  function_name: string | null;
  bash_command: string | null;
  created_at: string;
};

// ============================================================================
// PROMPTS
// User prompts extracted from user messages
// ============================================================================
export type Prompt = {
  id: number;
  session_id: string;
  user_id: string;
  repo_id: string | null;
  repo_name: string;
  agent_type: string;
  timestamp: string;
  prompt_text: string | null;
  turn_number: number | null;
  created_at: string;
};

// ============================================================================
// AGENT RESPONSES
// Agent text and thinking responses from assistant messages
// ============================================================================
export type AgentResponse = {
  id: number;
  session_id: string;
  user_id: string;
  repo_id: string | null;
  repo_name: string;
  agent_type: string;
  timestamp: string;
  response_text: string | null;
  response_type: 'text' | 'thinking';
  turn_number: number | null;
  created_at: string;
};

// ============================================================================
// OVERLAPS
// Detected overlaps (file-level, prompt-level, directory-level)
// ============================================================================
export type Overlap = {
  id: number;
  type: 'file' | 'prompt' | 'directory';
  severity: 'info' | 'warning' | 'high';
  overlap_scope: 'line' | 'function' | 'file' | 'directory';
  file_path: string | null;
  directory_path: string | null;
  start_line: number | null;
  end_line: number | null;
  function_name: string | null;
  repo_name: string;
  user_id_a: string;
  user_id_b: string;
  session_id_a: string | null;
  session_id_b: string | null;
  description: string | null;
  detected_at: string;
};

// ============================================================================
// WEB SESSIONS
// Browser sessions for authenticated dashboard access
// ============================================================================
export type WebSession = {
  id: string;
  token_hash: string;
  user_id: string | null;
  expires_at: string;
  created_at: string;
};

// ============================================================================
// INGEST EVENT TYPES
// Events sent by the tracer binary (agent-agnostic)
// ============================================================================
export type IngestEventType = 'session_start' | 'session_end' | 'file_op' | 'prompt' | 'agent_response';

export type IngestEvent = {
  session_id: string;
  timestamp: string;
  event_type: IngestEventType;
  user_id: string;
  repo_name: string;
  agent_type: string;

  // session_start only
  cwd?: string;
  git_branch?: string;
  model?: string;
  agent_version?: string;
  hostname?: string;
  device_name?: string;
  is_remote?: boolean;

  // file_op only
  tool_name?: string;
  file_path?: string;
  operation?: string;
  start_line?: number;
  end_line?: number;
  function_name?: string;
  bash_command?: string;

  // prompt only
  prompt_text?: string;
  turn_number?: number;

  // agent_response only
  response_text?: string;
  response_type?: 'text' | 'thinking';

  // session_end only
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  result_summary?: string;
  files_touched?: string[];
};

// ============================================================================
// COMPOSITE TYPES FOR UI
// ============================================================================

// Session with member info for timeline display
export type SessionWithMember = Session & {
  member: Pick<Member, 'user_id' | 'display_name'>;
  repo: Pick<Repo, 'id' | 'name' | 'display_name'> | null;
  last_activity_at?: string;
};

// Session detail with all related data
export type SessionDetail = Session & {
  member: Pick<Member, 'user_id' | 'display_name'>;
  repo: Pick<Repo, 'id' | 'name' | 'display_name'> | null;
  file_operations: FileOperation[];
  prompts: Prompt[];
  agent_responses: AgentResponse[];
};

// File activity for file history page
export type FileActivity = {
  file_path: string;
  repo_name: string;
  sessions_count: number;
  users_count: number;
  operations: Array<{
    user_id: string;
    display_name: string;
    session_id: string;
    tool_name: string;
    operation: string | null;
    timestamp: string;
    git_branch: string | null;
  }>;
};

// Stats for analytics
export type TeamStats = {
  total_sessions: number;
  total_cost_usd: number;
  total_files: number;
  avg_duration_ms: number;
  by_member: Array<{
    user_id: string;
    display_name: string;
    session_count: number;
    total_cost: number;
  }>;
  by_repo: Array<{
    repo_name: string;
    session_count: number;
    total_cost: number;
  }>;
  by_model: Array<{
    model: string;
    session_count: number;
    total_cost: number;
  }>;
  hottest_files: Array<{
    file_path: string;
    session_count: number;
    user_count: number;
  }>;
};

// Overlap with member names for display
export type OverlapWithMembers = Overlap & {
  member_a_name: string;
  member_b_name: string;
};
