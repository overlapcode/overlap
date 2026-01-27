import { useState, useEffect, useCallback } from 'react';
import { ActivityCard } from './ActivityCard';
import { formatRelativeTime } from '@lib/utils/time';
import { fetchWithTimeout } from '@lib/utils/fetch';

type Session = {
  id: string;
  user: { id: string; name: string };
  device: { id: string; name: string; is_remote: boolean };
  repo: { id: string; name: string; remote_url: string | null } | null;
  branch: string | null;
  worktree: string | null;
  status: 'active' | 'stale' | 'ended';
  started_at: string;
  last_activity_at: string;
  activity: {
    semantic_scope: string | null;
    summary: string | null;
    files: string[];
  } | null;
};

type UserActivitySummary = {
  userId: string;
  userName: string;
  sessionCount: number;
  latestActivity: string;
};

type UserAccordionProps = {
  user: UserActivitySummary;
  showStale: boolean;
};

const PAGE_SIZE = 20;

export function UserAccordion({ user, showStale }: UserAccordionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(
    async (currentOffset: number, append: boolean = false) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        const params = new URLSearchParams({
          view: 'byUser',
          userId: user.userId,
          limit: String(PAGE_SIZE),
          offset: String(currentOffset),
          includeStale: String(showStale),
        });

        const response = await fetchWithTimeout(`/api/v1/activity?${params}`);
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || 'Failed to fetch sessions');
        }

        const data = (await response.json()) as {
          data: { sessions: Session[]; hasMore: boolean };
        };

        if (append) {
          setSessions((prev) => [...prev, ...data.data.sessions]);
        } else {
          setSessions(data.data.sessions);
        }
        setHasMore(data.data.hasMore);
        setOffset(currentOffset + data.data.sessions.length);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [user.userId, showStale]
  );

  const handleToggle = () => {
    if (!isExpanded && sessions.length === 0) {
      fetchSessions(0);
    }
    setIsExpanded(!isExpanded);
  };

  const handleLoadMore = () => {
    fetchSessions(offset, true);
  };

  // Refetch when showStale changes (fetchSessions identity changes) and accordion is expanded
  useEffect(() => {
    if (isExpanded) {
      setOffset(0);
      fetchSessions(0);
    }
  }, [fetchSessions]);

  return (
    <div
      className="card"
      style={{
        marginBottom: 'var(--space-md)',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      {/* Accordion header */}
      <button
        onClick={handleToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-md)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <span
            style={{
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              display: 'inline-block',
              color: 'var(--text-muted)',
            }}
          >
            ▶
          </span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user.userName}</span>
          <span className="text-muted">·</span>
          <span className="text-secondary" style={{ fontSize: '0.875rem' }}>
            {user.sessionCount} session{user.sessionCount !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-muted" style={{ fontSize: '0.875rem' }}>
          {formatRelativeTime(user.latestActivity)}
        </span>
      </button>

      {/* Accordion content */}
      {isExpanded && (
        <div
          style={{
            padding: '0 var(--space-md) var(--space-md)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-lg)' }}>
              <img src="/loading.gif" alt="Loading" width={32} height={32} style={{ opacity: 0.8 }} />
            </div>
          ) : error ? (
            <div style={{ padding: 'var(--space-md)', color: 'var(--accent-orange)' }}>{error}</div>
          ) : sessions.length === 0 ? (
            <div className="text-muted" style={{ padding: 'var(--space-md)' }}>
              No sessions found
            </div>
          ) : (
            <>
              <div style={{ marginTop: 'var(--space-md)' }}>
                {sessions.map((session) => (
                  <ActivityCard key={session.id} session={session} />
                ))}
              </div>

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
            </>
          )}
        </div>
      )}
    </div>
  );
}
