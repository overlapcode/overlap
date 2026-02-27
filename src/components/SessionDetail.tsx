import { useState, useEffect, useCallback, memo } from 'react';
import { useRelativeTime, formatRelativeTime } from '@lib/utils/time';
import { parseGitHubUrl, deriveGitHubUrl, getRelativeFilePath, getStatusLabel, getAgentLabel, getFileUrl, getBranchUrl } from '@lib/utils/github';
import { fetchWithTimeout } from '@lib/utils/fetch';

type SessionInfo = {
  id: string;
  user: { id: string; name: string };
  device: { id: string; name: string; is_remote: boolean };
  repo: { id: string; name: string; remote_url: string | null } | null;
  branch: string | null;
  worktree: string | null;
  agent_type?: string;
  status: 'active' | 'stale' | 'ended';
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
};

type AgentResponseItem = {
  text: string;
  type: 'text' | 'thinking';
};

type ActivityItem = {
  id: string;
  session_id: string;
  files: string[];
  semantic_scope: string | null;
  summary: string | null;
  agent_responses?: AgentResponseItem[];
  created_at: string;
  block_index: number | null;
};

type ActivityBlockInfo = {
  block_index: number;
  name: string | null;
  description: string | null;
  task_type: string | null;
  started_at: string;
  ended_at: string | null;
  confidence: number | null;
};

type SessionDetailProps = {
  sessionId: string;
};

const PAGE_SIZE = 20;
const PROMPT_TRUNCATE = 300;
const RESPONSE_TRUNCATE = 500;

function ExpandableText({ text, limit, style }: { text: string; limit: number; style?: React.CSSProperties }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > limit;

  return (
    <span style={style}>
      {expanded || !needsTruncation ? text : text.slice(0, limit) + '...'}
      {needsTruncation && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent-blue)',
            cursor: 'pointer',
            fontSize: 'inherit',
            fontFamily: 'inherit',
            padding: '0 0 0 4px',
            textDecoration: 'none',
          }}
        >
          {expanded ? 'show less' : 'read more'}
        </button>
      )}
    </span>
  );
}

function SessionHeader({ session }: { session: SessionInfo }) {
  const relativeTime = useRelativeTime(session.last_activity_at);
  const githubBaseUrl = parseGitHubUrl(session.repo?.remote_url ?? null) ?? deriveGitHubUrl(session.repo?.name);
  const branchUrl = getBranchUrl(githubBaseUrl, session.branch);
  const agentLabel = getAgentLabel(session.agent_type);

  return (
    <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
      {/* User + Device + Status + Agent */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-md)' }}>
        <span style={{ fontWeight: 600, fontSize: '1.125rem' }}>{session.user.name}</span>
        <span className="text-muted">·</span>
        <span className="text-secondary">{session.device.name}</span>
        {session.device.is_remote && (
          <span className="text-muted" style={{ fontSize: '0.75rem' }}>(remote)</span>
        )}
        <span className="text-muted">·</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span className={`status-dot ${session.status}`} aria-label={`Status: ${session.status}`} />
          <span style={{ fontSize: '0.75rem', color: `var(--status-${session.status})` }}>
            {getStatusLabel(session.status)}
          </span>
        </span>
        {agentLabel && (
          <>
            <span className="text-muted">·</span>
            <span
              style={{
                fontSize: '0.6875rem',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {agentLabel}
            </span>
          </>
        )}
      </div>

      {/* Repo + Branch */}
      {(session.branch || session.repo) && (
        <div
          className="text-muted"
          style={{
            fontSize: '0.875rem',
            fontFamily: 'var(--font-mono)',
            marginBottom: 'var(--space-md)',
          }}
        >
          {session.branch && (
            branchUrl ? (
              <a href={branchUrl} target="_blank" rel="noopener noreferrer" className="footer-link">
                {session.branch}
              </a>
            ) : (
              <span>{session.branch}</span>
            )
          )}
          {session.branch && session.repo && <span> · </span>}
          {session.repo && (
            <a href={`/repo/${session.repo.id}`} className="footer-link">
              {session.repo.name}
            </a>
          )}
        </div>
      )}

      {/* Timestamps */}
      <div style={{ display: 'flex', gap: 'var(--space-lg)', fontSize: '0.875rem', flexWrap: 'wrap' }}>
        <div>
          <span className="text-muted">Started </span>
          <span className="text-secondary" title={session.started_at}>
            {formatRelativeTime(session.started_at)}
          </span>
        </div>
        <div>
          <span className="text-muted">Last activity </span>
          <span className="text-secondary" title={session.last_activity_at}>{relativeTime}</span>
        </div>
        {session.ended_at && (
          <div>
            <span className="text-muted">Ended </span>
            <span className="text-secondary" title={session.ended_at}>
              {formatRelativeTime(session.ended_at)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const ActivityRow = memo(function ActivityRow({ activity, session, githubBaseUrl }: { activity: ActivityItem; session: SessionInfo; githubBaseUrl: string | null }) {
  const agentLabel = getAgentLabel(session.agent_type);

  return (
    <div style={{
      padding: 'var(--space-md)',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      {/* Timestamp + scope */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
        <span className="text-muted" style={{ fontSize: '0.75rem' }} title={activity.created_at}>
          {formatRelativeTime(activity.created_at)}
        </span>
        {activity.semantic_scope && (
          <span className="scope-badge">{activity.semantic_scope}</span>
        )}
      </div>

      {/* User prompt */}
      {activity.summary && (
        <div style={{ marginBottom: 'var(--space-sm)' }}>
          <span style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            color: 'var(--accent-green)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'block',
            marginBottom: '2px',
          }}>
            {session.user.name}
          </span>
          <p className="text-primary" style={{ margin: 0, fontSize: '0.875rem' }}>
            <ExpandableText text={activity.summary} limit={PROMPT_TRUNCATE} />
          </p>
        </div>
      )}

      {/* Files */}
      {activity.files && activity.files.length > 0 && (
        <div className="files-list" style={{ marginBottom: 'var(--space-sm)' }}>
          {activity.files.map((file, i) => {
            const url = getFileUrl(file, githubBaseUrl, session.branch, session.worktree, session.repo?.name);
            const fileName = file.split('/').pop();
            const key = `${i}:${file}`;
            return url ? (
              <a
                key={key}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="file-tag file-tag-link"
                title={getRelativeFilePath(file, session.worktree)}
              >
                {fileName}
              </a>
            ) : (
              <span key={key} className="file-tag" title={file}>
                {fileName}
              </span>
            );
          })}
        </div>
      )}

      {/* Agent responses */}
      {activity.agent_responses && activity.agent_responses.length > 0 && (
        <div>
          {activity.agent_responses.map((resp, i) => (
            <div
              key={i}
              style={{
                padding: 'var(--space-sm) var(--space-md)',
                marginTop: 'var(--space-xs)',
                background: resp.type === 'thinking' ? 'var(--bg-primary)' : 'var(--bg-surface)',
                borderLeft: resp.type === 'thinking' ? '2px solid var(--text-muted)' : '2px solid var(--accent-blue)',
                borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                fontSize: '0.8125rem',
                color: resp.type === 'thinking' ? 'var(--text-muted)' : 'var(--text-secondary)',
                fontStyle: resp.type === 'thinking' ? 'italic' : 'normal',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <span style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: resp.type === 'thinking' ? 'var(--text-muted)' : 'var(--accent-blue)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'block',
                marginBottom: '2px',
              }}>
                {resp.type === 'thinking' ? `${agentLabel} thinking` : agentLabel}
              </span>
              <ExpandableText text={resp.text} limit={RESPONSE_TRUNCATE} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const TASK_TYPE_COLORS: Record<string, string> = {
  feature: 'var(--accent-orange)',
  bugfix: 'var(--accent-orange)',
  refactor: 'var(--accent-blue)',
  debug: 'var(--accent-orange)',
  test: 'var(--accent-green)',
  docs: 'var(--accent-green)',
  config: 'var(--text-muted)',
  exploration: 'var(--accent-blue)',
  review: 'var(--accent-blue)',
  migration: 'var(--accent-orange)',
  deploy: 'var(--accent-green)',
};

function BlockHeader({ block }: { block: ActivityBlockInfo }) {
  const color = TASK_TYPE_COLORS[block.task_type ?? ''] ?? 'var(--text-muted)';

  return (
    <div style={{
      padding: 'var(--space-sm) var(--space-md)',
      backgroundColor: 'var(--bg-elevated)',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'baseline',
      gap: 'var(--space-sm)',
      flexWrap: 'wrap',
    }}>
      <span style={{
        fontSize: '0.8125rem',
        fontWeight: 600,
        color: 'var(--text-primary)',
      }}>
        {block.name ?? `Block ${block.block_index + 1}`}
      </span>

      {block.task_type && (
        <span style={{
          fontSize: '0.6875rem',
          padding: '1px 6px',
          borderRadius: '4px',
          backgroundColor: 'var(--bg-primary)',
          border: `1px solid ${color}`,
          color: color,
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {block.task_type}
        </span>
      )}

      {block.description && (
        <span style={{
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          flex: '1 1 100%',
          marginTop: '2px',
        }}>
          {block.description}
        </span>
      )}
    </div>
  );
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityBlocks, setActivityBlocks] = useState<ActivityBlockInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = useCallback(async (offset: number, append: boolean = false, silent: boolean = false) => {
    if (append) {
      setIsLoadingMore(true);
    } else if (!silent) {
      setIsLoading(true);
    }

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });

      const res = await fetchWithTimeout(`/api/v1/sessions/${sessionId}/activities?${params}`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        if (res.status === 404) {
          setError('Session not found');
          return;
        }
        throw new Error(data.error || 'Failed to fetch session');
      }

      const json = (await res.json()) as {
        data: {
          session: SessionInfo;
          activities: ActivityItem[];
          activity_blocks?: ActivityBlockInfo[];
          total: number;
          hasMore: boolean;
        };
      };

      setSession(json.data.session);
      setActivityBlocks(json.data.activity_blocks ?? []);
      if (append) {
        setActivities((prev) => [...prev, ...json.data.activities]);
      } else {
        setActivities(json.data.activities);
      }
      setTotal(json.data.total);
      setHasMore(json.data.hasMore);
      setError(null);
    } catch (err) {
      // Don't show errors for silent poll refreshes
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchActivities(0);
  }, [fetchActivities]);

  // Poll for new activities every 5 seconds when session is active
  useEffect(() => {
    if (!session || session.status !== 'active') return;

    const interval = setInterval(() => {
      // Silent re-fetch to pick up new activities without loading state
      fetchActivities(0, false, true);
    }, 5000);

    return () => clearInterval(interval);
  }, [session?.status, fetchActivities]);

  const handleLoadMore = () => {
    fetchActivities(activities.length, true);
  };

  if (isLoading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
        <img src="/loading.gif" alt="Loading" width={48} height={48} style={{ opacity: 0.8 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
        <p style={{ color: 'var(--accent-orange)', marginBottom: 'var(--space-md)' }}>{error}</p>
        <a href="/" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Back to Timeline
        </a>
      </div>
    );
  }

  if (!session) return null;

  const githubBaseUrl = parseGitHubUrl(session.repo?.remote_url ?? null) ?? deriveGitHubUrl(session.repo?.name);

  return (
    <div>
      <SessionHeader session={session} />

      {/* Activity count */}
      <div style={{
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        marginBottom: 'var(--space-sm)',
        paddingLeft: 'var(--space-sm)',
      }}>
        {total} {total === 1 ? 'activity' : 'activities'}
      </div>

      {/* Activity list */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {activities.length > 0 ? (
          (() => {
            const blockMap = new Map(activityBlocks.map((b) => [b.block_index, b]));
            let lastBlockIndex: number | null | undefined = undefined;

            return activities.map((act) => {
              const showHeader = act.block_index !== lastBlockIndex && act.block_index !== null;
              const block = showHeader ? blockMap.get(act.block_index!) : null;
              lastBlockIndex = act.block_index;

              return (
                <div key={act.id}>
                  {block && <BlockHeader block={block} />}
                  <ActivityRow activity={act} session={session} githubBaseUrl={githubBaseUrl} />
                </div>
              );
            });
          })()
        ) : (
          <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
            <p className="text-muted" style={{ fontStyle: 'italic' }}>
              No activity recorded yet
            </p>
          </div>
        )}
      </div>

      {/* Load more */}
      {hasMore && (
        <button
          onClick={handleLoadMore}
          disabled={isLoadingMore}
          style={{
            width: '100%',
            padding: 'var(--space-sm)',
            marginTop: 'var(--space-sm)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)',
            cursor: isLoadingMore ? 'wait' : 'pointer',
            fontSize: '0.875rem',
          }}
        >
          {isLoadingMore ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
}
