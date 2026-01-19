import { useState, useEffect, useCallback, useRef } from 'react';
import { ActivityCard } from './ActivityCard';
import { ViewToggle } from './ViewToggle';
import { UserActivityList } from './UserActivityList';

type ViewMode = 'timeline' | 'byUser';

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

const PAGE_SIZE = 20;

function getInitialViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'timeline';
  const stored = localStorage.getItem('overlap-view-mode');
  return stored === 'byUser' ? 'byUser' : 'timeline';
}

export function Timeline() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showStale, setShowStale] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const prevShowStaleRef = useRef(showStale);

  const fetchSessions = useCallback(
    async (currentOffset: number, append: boolean = false) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(currentOffset),
          includeStale: String(showStale),
        });

        const response = await fetch(`/api/v1/activity?${params}`);

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || 'Failed to fetch activity');
        }

        const data = (await response.json()) as {
          data: { sessions: Session[]; hasMore: boolean; total: number };
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
        setError(err instanceof Error ? err.message : 'Failed to load activity');
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [showStale]
  );

  // Initial fetch and SSE setup
  useEffect(() => {
    if (viewMode === 'timeline') {
      fetchSessions(0);
    }

    // Set up SSE connection (uses session cookie automatically)
    const eventSource = new EventSource('/api/v1/stream');

    eventSource.addEventListener('connected', () => {
      setIsConnected(true);
      setError(null);
    });

    eventSource.addEventListener('activity', (event) => {
      try {
        const newSession = JSON.parse(event.data) as Session;
        setSessions((prev) => {
          // Update existing session or add new one
          const existing = prev.findIndex((s) => s.id === newSession.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = newSession;
            // Re-sort by last activity
            updated.sort(
              (a, b) =>
                new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime()
            );
            return updated;
          }
          return [newSession, ...prev];
        });
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    });

    eventSource.addEventListener('error', () => {
      setIsConnected(false);
      setError('Connection lost. Reconnecting...');
    });

    return () => {
      eventSource.close();
    };
  }, [viewMode, fetchSessions]);

  // Refetch when showStale changes
  useEffect(() => {
    if (prevShowStaleRef.current !== showStale && viewMode === 'timeline') {
      setOffset(0);
      fetchSessions(0);
    }
    prevShowStaleRef.current = showStale;
  }, [showStale, viewMode, fetchSessions]);

  // Save view mode to localStorage
  useEffect(() => {
    localStorage.setItem('overlap-view-mode', viewMode);
  }, [viewMode]);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'timeline') {
      setOffset(0);
      fetchSessions(0);
    }
  };

  const handleLoadMore = () => {
    fetchSessions(offset, true);
  };

  const hasStale = sessions.some((s) => s.status === 'stale');

  return (
    <div>
      {/* Header bar with connection status, view toggle, and stale toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          marginBottom: 'var(--space-lg)',
          padding: 'var(--space-sm) var(--space-md)',
          backgroundColor: 'var(--bg-surface)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.875rem',
          flexWrap: 'wrap',
        }}
      >
        <span
          className={`status-dot ${isConnected ? 'active' : 'stale'}`}
          style={{ width: 6, height: 6 }}
        />
        <span className="text-secondary">{isConnected ? 'Connected' : 'Connecting...'}</span>
        {error && (
          <>
            <span className="text-muted">·</span>
            <span style={{ color: 'var(--accent-orange)' }}>{error}</span>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <ViewToggle value={viewMode} onChange={handleViewModeChange} />
          {(hasStale || showStale) && (
            <button
              onClick={() => setShowStale(!showStale)}
              style={{
                background: 'none',
                border: 'none',
                color: showStale ? 'var(--text-secondary)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.875rem',
                padding: 0,
              }}
            >
              {showStale ? 'Hide stale' : 'Show stale'}
            </button>
          )}
        </div>
      </div>

      {/* Content based on view mode */}
      {viewMode === 'byUser' ? (
        <UserActivityList showStale={showStale} />
      ) : (
        <>
          {(() => {
            const activeSessions = sessions.filter((s) => s.status !== 'stale');
            const displayedSessions = showStale ? sessions : activeSessions;

            if (isLoading) {
              return (
                <div
                  className="card"
                  style={{
                    textAlign: 'center',
                    padding: 'var(--space-xl)',
                  }}
                >
                  <img
                    src="/loading.gif"
                    alt="Loading"
                    width={48}
                    height={48}
                    style={{ opacity: 0.8 }}
                  />
                </div>
              );
            }

            if (displayedSessions.length === 0) {
              return (
                <div
                  className="card"
                  style={{
                    textAlign: 'center',
                    padding: 'var(--space-xl)',
                  }}
                >
                  <p className="text-secondary">No active sessions</p>
                  <p
                    className="text-muted"
                    style={{ fontSize: '0.875rem', marginTop: 'var(--space-sm)' }}
                  >
                    Activity will appear here when team members start coding
                  </p>
                </div>
              );
            }

            return (
              <>
                {displayedSessions.map((session) => (
                  <ActivityCard key={session.id} session={session} />
                ))}

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
            );
          })()}
        </>
      )}
    </div>
  );
}
