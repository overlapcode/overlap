import { useState, useEffect, useCallback, useRef } from 'react';
import { ActivityCard } from './ActivityCard';
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

type FilterMeta = {
  branches: string[];
  users: { id: string; name: string }[];
};

type RepoActivityProps = {
  repoId: string;
};

const PAGE_SIZE = 20;

export function RepoActivity({ repoId }: RepoActivityProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [filterMeta, setFilterMeta] = useState<FilterMeta>({ branches: [], users: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Filter state
  const [userId, setUserId] = useState('');
  const [branch, setBranch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [includeStale, setIncludeStale] = useState(true);

  const abortRef = useRef<AbortController | null>(null);

  const hasActiveFilters = userId || branch || startDate || endDate;

  const fetchSessions = useCallback(
    async (currentOffset: number, append: boolean = false) => {
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
          includeStale: String(includeStale),
        });

        if (userId) params.set('userId', userId);
        if (branch) params.set('branch', branch);
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);

        const response = await fetchWithTimeout(`/api/v1/repos/${repoId}/activity?${params}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error || 'Failed to fetch repo activity');
        }

        const data = (await response.json()) as {
          data: {
            sessions: Session[];
            hasMore: boolean;
            total: number;
            filters: FilterMeta;
          };
        };

        if (append) {
          setSessions((prev) => [...prev, ...data.data.sessions]);
        } else {
          setSessions(data.data.sessions);
        }
        setHasMore(data.data.hasMore);
        setTotal(data.data.total);
        setFilterMeta(data.data.filters);
        setFetchError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFetchError(err instanceof Error ? err.message : 'Failed to load activity');
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [repoId, userId, branch, startDate, endDate, includeStale]
  );

  useEffect(() => {
    fetchSessions(0);
    return () => abortRef.current?.abort();
  }, [fetchSessions]);

  const handleLoadMore = () => {
    fetchSessions(sessions.length, true);
  };

  const clearFilters = () => {
    setUserId('');
    setBranch('');
    setStartDate('');
    setEndDate('');
  };

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    fontSize: '0.8rem',
    padding: '6px 8px',
    cursor: 'pointer',
    minWidth: 0,
  };

  const dateStyle: React.CSSProperties = {
    ...selectStyle,
    colorScheme: 'dark',
    maxWidth: 140,
  };

  return (
    <div>
      {/* Filter bar */}
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
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          style={selectStyle}
        >
          <option value="">All members</option>
          {filterMeta.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>

        <select
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          style={selectStyle}
        >
          <option value="">All branches</option>
          {filterMeta.branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          placeholder="From"
          title="From date"
          style={dateStyle}
        />
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          placeholder="To"
          title="To date"
          style={dateStyle}
        />

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-orange)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                padding: 0,
              }}
            >
              Clear filters
            </button>
          )}
          <button
            onClick={() => setIncludeStale(!includeStale)}
            aria-pressed={includeStale}
            style={{
              background: 'none',
              border: 'none',
              color: includeStale ? 'var(--text-secondary)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              padding: 0,
            }}
          >
            {includeStale ? 'Hide stale' : 'Show stale'}
          </button>
        </div>
      </div>

      {/* Results count */}
      {!isLoading && (
        <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-sm)' }}>
          {total} session{total !== 1 ? 's' : ''}
          {hasActiveFilters ? ' (filtered)' : ''}
        </div>
      )}

      {/* Session list */}
      {isLoading ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: 'var(--space-xl)' }}
        >
          <img src="/loading.gif" alt="Loading" width={48} height={48} style={{ opacity: 0.8 }} />
        </div>
      ) : fetchError ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--accent-orange)' }}
        >
          {fetchError}
        </div>
      ) : sessions.length === 0 ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: 'var(--space-xl)' }}
        >
          <p className="text-secondary">No sessions found</p>
          <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: 'var(--space-sm)' }}>
            {hasActiveFilters
              ? 'Try adjusting your filters'
              : 'Activity will appear here when team members work in this repo'}
          </p>
        </div>
      ) : (
        <>
          {sessions.map((session) => (
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
      )}
    </div>
  );
}
