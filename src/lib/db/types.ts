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
  remote_url: string | null;
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
  old_string: string | null;
  new_string: string | null;
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
  decision: 'block' | 'warn' | null;
  public_id: string | null;
  detected_at: string;
};

// ============================================================================
// ACTIVITY BLOCKS
// Goal-level groupings within a session (LLM-classified)
// ============================================================================
export type ActivityBlock = {
  id: number;
  session_id: string;
  user_id: string;
  repo_name: string;
  block_index: number;
  started_at: string;
  ended_at: string | null;
  name: string | null;
  description: string | null;
  task_type: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
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
  old_string?: string;
  new_string?: string;

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
// INSIGHTS
// Generated insight reports (per user or team, per period)
// ============================================================================
export type InsightPeriodType = 'week' | 'month' | 'quarter' | 'year';
export type InsightScope = 'user' | 'team';
export type InsightStatus = 'pending' | 'generating' | 'completed' | 'failed';

export type Insight = {
  id: string;
  scope: InsightScope;
  user_id: string | null;
  period_type: InsightPeriodType;
  period_start: string;
  period_end: string;
  model_used: string | null;
  status: InsightStatus;
  content: string | null; // JSON string of InsightContent
  error: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
};

// ============================================================================
// SESSION FACETS
// Per-session LLM analysis (Layer 1 of two-layer insights)
// ============================================================================
export type SessionFacet = {
  id: string;
  session_id: string;
  user_id: string;
  underlying_goal: string | null;
  goal_categories: string | null; // JSON: Record<string, number>
  outcome: 'fully_achieved' | 'mostly_achieved' | 'partially_achieved' | 'not_achieved' | null;
  session_type: 'single_task' | 'multi_task' | 'exploration' | 'debugging' | 'infrastructure' | null;
  friction_counts: string | null; // JSON: Record<string, number>
  friction_detail: string | null;
  primary_success: string | null;
  brief_summary: string | null;
  model_used: string | null;
  generated_at: string | null;
  created_at: string;
};

export type ParsedGoalCategories = Record<string, number>;
export type ParsedFrictionCounts = Record<string, number>;

export type InsightContent = {
  // Stats (always present)
  stats: {
    total_sessions: number;
    total_cost_usd: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_files_touched: number;
    total_prompts: number;
    avg_session_duration_ms: number;
    total_overlaps: number;
    total_blocks: number;
    total_warns: number;
  };
  by_repo: Array<{
    repo_name: string;
    session_count: number;
    file_count: number;
    cost: number;
  }>;
  by_model: Array<{
    model: string;
    session_count: number;
    cost: number;
  }>;
  hottest_files: Array<{
    file_path: string;
    repo_name: string;
    edit_count: number;
    user_count: number;
  }>;
  tool_usage: Array<{
    tool_name: string;
    count: number;
  }>;

  // Facet aggregation (from Layer 1)
  facet_stats?: {
    total_facets: number;
    outcomes: Record<string, number>;
    session_types: Record<string, number>;
    top_goal_categories: Array<{ category: string; count: number }>;
    total_friction_events: number;
    friction_by_type: Record<string, number>;
  };

  // LLM synthesis (from Layer 2)
  summary: string;
  highlights: string[];
  project_areas: Array<{
    name: string;
    session_count: number;
    description: string;
  }>;
  interaction_style?: string;
  friction_analysis: Array<{
    category: string;
    description: string;
    examples: string[];
  }>;
  accomplishments: Array<{
    title: string;
    description: string;
  }>;
  narrative: string;
  recommendations: Array<{
    title: string;
    description: string;
  }>;
};

// ============================================================================
// COMPOSITE TYPES FOR UI
// ============================================================================

// Session with member info for timeline display
export type SessionWithMember = Session & {
  member: Pick<Member, 'user_id' | 'display_name'>;
  repo: Pick<Repo, 'id' | 'name' | 'display_name' | 'remote_url'> | null;
  last_activity_at?: string;
};

// Session detail with all related data
export type SessionDetail = Session & {
  member: Pick<Member, 'user_id' | 'display_name'>;
  repo: Pick<Repo, 'id' | 'name' | 'display_name' | 'remote_url'> | null;
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
  total_input_tokens: number;
  total_output_tokens: number;
  by_member: Array<{
    user_id: string;
    display_name: string;
    session_count: number;
    total_cost: number;
  }>;
  by_repo: Array<{
    repo_name: string;
    repo_id: string | null;
    remote_url: string | null;
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
    repo_name: string;
    remote_url: string | null;
    session_count: number;
    user_count: number;
  }>;
  savings: {
    estimated_savings_usd: number;
    overlap_count: number;
    block_count: number;
    warn_count: number;
  };
};

// Overlap with member names for display
export type OverlapWithMembers = Overlap & {
  member_a_name: string;
  member_b_name: string;
};

// Overlap detail with both users' file operations for comparison
export type OverlapDetail = OverlapWithMembers & {
  edits_a: FileOperation[];
  edits_b: FileOperation[];
  first_user: 'a' | 'b';
};
