import { useState, useEffect, useCallback, useRef } from 'react';
import { ActivityCard } from './ActivityCard';
import { ViewToggle } from './ViewToggle';
import { UserActivityList } from './UserActivityList';
import { useSSE } from '@lib/hooks/useSSE';
import { fetchWithTimeout } from '@lib/utils/fetch';

type ViewMode = 'timeline' | 'byUser';

type Session = {
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
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showStale, setShowStale] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode);
  const [hasMore, setHasMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // SSE hook for real-time updates
  const handleSSEEvent = useCallback((event: MessageEvent) => {
    try {
      const newSession = JSON.parse(event.data) as Session;
      setSessions((prev) => {
        const existing = prev.findIndex((s) => s.id === newSession.id);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = newSession;
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
  }, []);

  const { connectionState, error: sseError, reconnect } = useSSE({
    url: '/api/v1/stream',
    onEvent: handleSSEEvent,
    eventName: 'activity',
    enabled: true,
  });

  const fetchSessions = useCallback(
    async (currentOffset: number, append: boolean = false) => {
      // Abort previous request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

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

        const response = await fetchWithTimeout(`/api/v1/activity?${params}`, {
          signal: controller.signal,
        });

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
        setFetchError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFetchError(err instanceof Error ? err.message : 'Failed to load activity');
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [showStale]
  );

  // Fetch when viewMode, showStale, or fetchSessions identity changes
  useEffect(() => {
    if (viewMode === 'timeline') {
      fetchSessions(0);
    }
    return () => abortRef.current?.abort();
  }, [viewMode, fetchSessions]);

  // Save view mode to localStorage
  useEffect(() => {
    localStorage.setItem('overlap-view-mode', viewMode);
  }, [viewMode]);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
  };

  const handleLoadMore = () => {
    fetchSessions(sessions.length, true);
  };

  const isConnected = connectionState === 'connected';
  const displayError = fetchError || sseError;

  return (
    <div>
      {/* Header bar with connection status, view toggle, and stale toggle */}
      <div
        role="status"
        aria-live="polite"
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
          aria-label={isConnected ? 'Connected' : 'Disconnected'}
        />
        <span className="text-secondary">{isConnected ? 'Connected' : 'Connecting...'}</span>
        {displayError && (
          <>
            <span className="text-muted">·</span>
            <span
              style={{ color: 'var(--accent-orange)', cursor: sseError ? 'pointer' : 'default' }}
              onClick={sseError ? reconnect : undefined}
            >
              {displayError}
            </span>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <ViewToggle value={viewMode} onChange={handleViewModeChange} />
          <button
            onClick={() => setShowStale(!showStale)}
            aria-pressed={showStale}
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
