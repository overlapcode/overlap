import { useState, useEffect, useCallback } from 'react';
import { formatRelativeTime } from '@lib/utils/time';
import { getStatusLabel } from '@lib/utils/github';
import { fetchWithTimeout } from '@lib/utils/fetch';

type ActivityItem = {
  id: string;
  files: string[];
  semantic_scope: string | null;
  summary: string | null;
  created_at: string;
};

type HistorySession = {
  id: string;
  device: { name: string; is_remote: boolean };
  repo: { id: string; name: string } | null;
  branch: string | null;
  status: 'active' | 'stale' | 'ended';
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
  activities: ActivityItem[];
};

const PAGE_SIZE = 20;

function HistoryCard({ session }: { session: HistorySession }) {
  const [expanded, setExpanded] = useState(false);

  const handleToggle = () => setExpanded(!expanded);

  return (
    <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
      {/* Header — clickable to expand */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={handleToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(); } }}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <span
            style={{
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              display: 'inline-block',
              color: 'var(--text-muted)',
              fontSize: '0.625rem',
            }}
          >
            ▶
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className={`status-dot ${session.status}`} aria-label={`Status: ${session.status}`} />
            <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
              {getStatusLabel(session.status)}
            </span>
          </span>
          <span className="text-muted">·</span>
          <span className="text-secondary">{session.device.name}</span>
          {session.device.is_remote && (
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>(remote)</span>
          )}
        </div>
        <span className="text-muted" style={{ fontSize: '0.875rem', flexShrink: 0 }}>
          {formatRelativeTime(session.started_at)}
        </span>
      </div>

      {/* Latest activity summary (always visible) */}
      {session.activities.length > 0 && session.activities[0].summary && (
        <p className="text-primary" style={{ marginTop: 'var(--space-sm)', fontSize: '0.875rem' }}>
          {session.activities[0].summary}
        </p>
      )}

      {/* Branch + repo footer */}
      {(session.branch || session.repo) && (
        <div
          className="text-muted"
          style={{
            marginTop: 'var(--space-sm)',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {session.branch && <span>{session.branch}</span>}
          {session.branch && session.repo && <span> · </span>}
          {session.repo && (
            <a href={`/repo/${session.repo.id}`} className="footer-link" onClick={(e) => e.stopPropagation()}>
              {session.repo.name}
            </a>
          )}
        </div>
      )}

      {/* Session detail link */}
      <a
        href={`/session/${session.id}`}
        style={{
          display: 'inline-block',
          marginTop: 'var(--space-sm)',
          fontSize: '0.75rem',
          color: 'var(--accent-blue)',
          textDecoration: 'none',
        }}
      >
        View session →
      </a>

      {/* Expandable activities section */}
      {expanded && (
        <div style={{
          marginTop: 'var(--space-md)',
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: 'var(--space-md)',
        }}>
          {/* Timestamps */}
          <div style={{ display: 'flex', gap: 'var(--space-lg)', fontSize: '0.875rem', flexWrap: 'wrap', marginBottom: 'var(--space-md)' }}>
            <div>
              <span className="text-muted">Started </span>
              <span className="text-secondary" title={session.started_at}>
                {formatRelativeTime(session.started_at)}
              </span>
            </div>
            <div>
              <span className="text-muted">Last activity </span>
              <span className="text-secondary" title={session.last_activity_at}>
                {formatRelativeTime(session.last_activity_at)}
              </span>
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

          {/* Activity list header */}
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.05em',
            marginBottom: 'var(--space-sm)',
          }}>
            Activities ({session.activities.length}{session.activities.length >= 10 ? '+' : ''})
          </div>

          {session.activities.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              {session.activities.map((act) => (
                <div
                  key={act.id}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 'var(--space-sm)',
                    padding: 'var(--space-xs) 0',
                    fontSize: '0.875rem',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <span className="text-muted" style={{ fontSize: '0.75rem', flexShrink: 0 }}>
                    {formatRelativeTime(act.created_at)}
                  </span>
                  {act.semantic_scope && (
                    <span className="scope-badge" style={{ fontSize: '0.6875rem' }}>{act.semantic_scope}</span>
                  )}
                  {act.summary && (
                    <span className="text-secondary" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {act.summary}
                    </span>
                  )}
                  {act.files.length > 0 && (
                    <span className="text-muted" style={{ fontSize: '0.75rem', flexShrink: 0 }}>
                      {act.files.length} file{act.files.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted" style={{ fontSize: '0.875rem' }}>
              No activity recorded yet
            </div>
          )}

          <a
            href={`/session/${session.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'inline-block',
              marginTop: 'var(--space-sm)',
              fontSize: '0.875rem',
              color: 'var(--accent-blue)',
              textDecoration: 'none',
            }}
          >
            View full session →
          </a>
        </div>
      )}
    </div>
  );
}

export function SessionHistory() {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async (offset: number, append: boolean = false) => {
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

      const res = await fetchWithTimeout(`/api/v1/users/me/timeline?${params}`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || 'Failed to fetch history');
      }

      const json = (await res.json()) as {
        data: {
          sessions: HistorySession[];
          hasMore: boolean;
        };
      };

      if (append) {
        setSessions((prev) => [...prev, ...json.data.sessions]);
      } else {
        setSessions(json.data.sessions);
      }
      setHasMore(json.data.hasMore);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions(0);
  }, [fetchSessions]);

  const handleLoadMore = () => {
    fetchSessions(sessions.length, true);
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
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
        <p className="text-muted" style={{ fontStyle: 'italic' }}>
          No sessions yet
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Session count */}
      <div style={{
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        marginBottom: 'var(--space-sm)',
        paddingLeft: 'var(--space-sm)',
      }}>
        My Sessions
      </div>

      {sessions.map((session) => (
        <HistoryCard key={session.id} session={session} />
      ))}

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
