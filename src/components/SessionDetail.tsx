import { useState, useEffect, useCallback, memo } from 'react';
import { useRelativeTime, formatRelativeTime } from '@lib/utils/time';
import { parseGitHubUrl, getRelativeFilePath, getStatusLabel, getFileUrl, getBranchUrl } from '@lib/utils/github';
import { fetchWithTimeout } from '@lib/utils/fetch';

type SessionInfo = {
  id: string;
  user: { id: string; name: string };
  device: { id: string; name: string; is_remote: boolean };
  repo: { id: string; name: string; remote_url: string | null } | null;
  branch: string | null;
  worktree: string | null;
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
};

type SessionDetailProps = {
  sessionId: string;
};

const PAGE_SIZE = 20;

function SessionHeader({ session }: { session: SessionInfo }) {
  const relativeTime = useRelativeTime(session.last_activity_at);
  const githubBaseUrl = parseGitHubUrl(session.repo?.remote_url ?? null);
  const branchUrl = getBranchUrl(githubBaseUrl, session.branch);
  const repoUrl = githubBaseUrl;

  return (
    <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
      {/* User + Device + Status */}
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
          <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
            {getStatusLabel(session.status)}
          </span>
        </span>
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
            repoUrl ? (
              <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="footer-link">
                {session.repo.name}
              </a>
            ) : (
              <span>{session.repo.name}</span>
            )
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

      {/* Summary (user prompt) */}
      {activity.summary && (
        <p className="text-primary" style={{ marginBottom: 'var(--space-sm)', fontSize: '0.875rem' }}>
          {activity.summary}
        </p>
      )}

      {/* Agent responses */}
      {activity.agent_responses && activity.agent_responses.length > 0 && (
        <div style={{ marginBottom: 'var(--space-sm)' }}>
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
              {resp.type === 'thinking' && (
                <span style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '2px', opacity: 0.7 }}>
                  Thinking
                </span>
              )}
              {resp.text}
            </div>
          ))}
        </div>
      )}

      {/* Files */}
      {activity.files && activity.files.length > 0 && (
        <div className="files-list">
          {activity.files.map((file, i) => {
            const url = getFileUrl(file, githubBaseUrl, session.branch, session.worktree);
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
    </div>
  );
});

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = useCallback(async (offset: number, append: boolean = false) => {
    if (append) {
      setIsLoadingMore(true);
    } else {
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
          total: number;
          hasMore: boolean;
        };
      };

      setSession(json.data.session);
      if (append) {
        setActivities((prev) => [...prev, ...json.data.activities]);
      } else {
        setActivities(json.data.activities);
      }
      setTotal(json.data.total);
      setHasMore(json.data.hasMore);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchActivities(0);
  }, [fetchActivities]);

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

  const githubBaseUrl = parseGitHubUrl(session.repo?.remote_url ?? null);

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
          activities.map((act) => (
            <ActivityRow key={act.id} activity={act} session={session} githubBaseUrl={githubBaseUrl} />
          ))
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
