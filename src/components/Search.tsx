import { useState, useEffect, useCallback, useRef } from 'react';
import { formatRelativeTime } from '@lib/utils/time';
import { fetchWithTimeout } from '@lib/utils/fetch';
import { useBasePath } from '@lib/hooks/useBasePath';

// ── Types ─────────────────────────────────────────────────────────────

type ContextActivity = {
  id: string;
  source_type: 'prompt' | 'response';
  content: string;
  timestamp: string;
};

type SearchMatch = {
  source_type: string;
  source_id: string;
  snippet: string;
  timestamp: string;
  rank: number;
};

type SearchResult = {
  session_id: string;
  session: {
    user_name: string;
    repo_name: string;
    branch: string | null;
    started_at: string;
    status: string;
  };
  matches: SearchMatch[];
};

type SearchResponse = {
  data: {
    results: SearchResult[];
    count: number;
    query: string;
    hasMore: boolean;
  };
};

type ContextResponse = {
  data: {
    activities: ContextActivity[];
    match_timestamp: string;
  };
};

// ── Components ────────────────────────────────────────────────────────

function MatchCard({ match, sessionId }: { match: SearchMatch; sessionId: string }) {
  const [showContext, setShowContext] = useState(false);
  const [context, setContext] = useState<ContextActivity[]>([]);
  const [loadingContext, setLoadingContext] = useState(false);

  const handleToggleContext = async () => {
    if (showContext) {
      setShowContext(false);
      return;
    }

    // Lazy-load context on first click
    if (context.length === 0) {
      setLoadingContext(true);
      try {
        const params = new URLSearchParams({ session_id: sessionId, timestamp: match.timestamp });
        const res = await fetchWithTimeout(`/api/v1/search-context?${params}`);
        if (res.ok) {
          const json = (await res.json()) as ContextResponse;
          setContext(json.data.activities);
        }
      } catch {
        // Silently fail — context is optional
      } finally {
        setLoadingContext(false);
      }
    }
    setShowContext(true);
  };

  return (
    <div style={{
      padding: 'var(--space-sm) 0',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      {/* Match snippet with highlighted terms */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-sm)' }}>
        <span style={{
          fontSize: '0.6875rem',
          padding: '1px 6px',
          borderRadius: 'var(--radius-sm)',
          background: match.source_type === 'prompt' ? 'var(--accent-blue)' : match.source_type === 'response' ? 'var(--accent-green)' : 'var(--accent-purple)',
          color: 'var(--bg-primary)',
          flexShrink: 0,
          fontWeight: 500,
        }}>
          {match.source_type === 'prompt' ? 'prompt' : match.source_type === 'response' ? 'response' : 'activity'}
        </span>
        <span
          className="text-secondary"
          style={{ fontSize: '0.875rem', lineHeight: 1.5 }}
          dangerouslySetInnerHTML={{ __html: match.snippet }}
        />
      </div>

      {/* Timestamp + context toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginTop: '4px' }}>
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>
          {formatRelativeTime(match.timestamp)}
        </span>
        <button
          onClick={handleToggleContext}
          disabled={loadingContext}
          style={{
            fontSize: '0.75rem',
            color: 'var(--accent-blue)',
            background: 'none',
            border: 'none',
            cursor: loadingContext ? 'wait' : 'pointer',
            padding: 0,
          }}
        >
          {loadingContext ? 'Loading...' : showContext ? 'Hide context' : 'Show context'}
        </button>
      </div>

      {/* Surrounding context (lazy-loaded) */}
      {showContext && context.length > 0 && (
        <div style={{
          marginTop: 'var(--space-sm)',
          marginLeft: 'var(--space-md)',
          borderLeft: '2px solid var(--border-subtle)',
          paddingLeft: 'var(--space-sm)',
        }}>
          {context.map((ctx) => {
            const isMatch = ctx.timestamp === match.timestamp && ctx.source_type === match.source_type;
            return (
              <div
                key={`${ctx.source_type}-${ctx.id}-${ctx.timestamp}`}
                style={{
                  padding: '4px 0',
                  background: isMatch ? 'var(--bg-elevated)' : 'transparent',
                  borderRadius: isMatch ? 'var(--radius-sm)' : 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-xs)' }}>
                  <span className="text-muted" style={{ fontSize: '0.6875rem', flexShrink: 0 }}>
                    {ctx.source_type === 'prompt' ? '>' : '<'}
                  </span>
                  <span
                    className={isMatch ? 'text-primary' : 'text-secondary'}
                    style={{ fontSize: '0.8125rem', fontWeight: isMatch ? 500 : 400 }}
                  >
                    {ctx.content}
                  </span>
                </div>
                <span className="text-muted" style={{ fontSize: '0.6875rem', marginLeft: 'var(--space-md)' }}>
                  {formatRelativeTime(ctx.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SearchResultCard({ result }: { result: SearchResult }) {
  const basePath = useBasePath();

  return (
    <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
      {/* Session header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <span className={`status-dot ${result.session.status}`} />
          <span className="text-primary" style={{ fontWeight: 500 }}>{result.session.user_name}</span>
          <span className="text-muted">·</span>
          <span className="text-secondary" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
            {result.session.repo_name}
          </span>
          {result.session.branch && (
            <>
              <span className="text-muted">·</span>
              <span className="text-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                {result.session.branch}
              </span>
            </>
          )}
        </div>
        <span className="text-muted" style={{ fontSize: '0.75rem', flexShrink: 0 }}>
          {formatRelativeTime(result.session.started_at)}
        </span>
      </div>

      {/* Matches */}
      {result.matches.map((match, idx) => (
        <MatchCard key={`${match.source_id}-${idx}`} match={match} sessionId={result.session_id} />
      ))}

      {/* Link to full session */}
      <a
        href={`${basePath}/session/${result.session_id}`}
        style={{
          display: 'inline-block',
          marginTop: 'var(--space-sm)',
          fontSize: '0.75rem',
          color: 'var(--accent-blue)',
          textDecoration: 'none',
        }}
      >
        View full session →
      </a>
    </div>
  );
}

// ── Main Search Component ─────────────────────────────────────────────

export function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const performSearch = useCallback(async (q: string, offset = 0) => {
    if (q.length < 2) return;

    if (offset === 0) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams({ q, limit: '20', offset: String(offset) });
      const res = await fetchWithTimeout(`/api/v1/search?${params}`);

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || 'Search failed');
      }

      const json = (await res.json()) as SearchResponse;

      if (offset === 0) {
        setResults(json.data.results);
      } else {
        setResults((prev) => [...prev, ...json.data.results]);
      }
      setHasMore(json.data.hasMore);
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Read initial query from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      setQuery(q);
      performSearch(q);
    }
    inputRef.current?.focus();
  }, [performSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.length < 2) return;

    const url = new URL(window.location.href);
    url.searchParams.set('q', query);
    window.history.replaceState({}, '', url.toString());

    performSearch(query);
  };

  const handleInputChange = (value: string) => {
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length >= 2) {
      debounceRef.current = setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set('q', value);
        window.history.replaceState({}, '', url.toString());
        performSearch(value);
      }, 500);
    }
  };

  // Count total matches across all result groups
  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

  return (
    <div>
      {/* Search form */}
      <form onSubmit={handleSubmit} style={{ marginBottom: 'var(--space-lg)' }}>
        <div style={{
          display: 'flex',
          gap: 'var(--space-sm)',
        }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Search activities... (e.g. customer dashboard variant)"
            style={{
              flex: 1,
              padding: 'var(--space-sm) var(--space-md)',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.9375rem',
            }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={query.length < 2 || isLoading}
          >
            {isLoading ? '...' : 'Search'}
          </button>
        </div>
        <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 'var(--space-xs)' }}>
          Searches across prompts, agent responses, and activity summaries
        </p>
      </form>

      {/* Error */}
      {error && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-lg)', marginBottom: 'var(--space-md)' }}>
          <p style={{ color: 'var(--accent-orange)' }}>{error}</p>
        </div>
      )}

      {/* Loading */}
      {isLoading && results.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
          <img src="/loading.gif" alt="Loading" width={48} height={48} style={{ opacity: 0.8 }} />
        </div>
      )}

      {/* Results */}
      {!isLoading && hasSearched && results.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
          <p className="text-muted" style={{ fontStyle: 'italic' }}>
            No results found for "{query}"
          </p>
        </div>
      )}

      {results.length > 0 && (
        <>
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.05em',
            marginBottom: 'var(--space-sm)',
            paddingLeft: 'var(--space-sm)',
          }}>
            {totalMatches} match{totalMatches !== 1 ? 'es' : ''} across {results.length} session{results.length !== 1 ? 's' : ''}
          </div>

          {results.map((result) => (
            <SearchResultCard key={result.session_id} result={result} />
          ))}

          {hasMore && (
            <button
              onClick={() => performSearch(query, totalMatches)}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: 'var(--space-sm)',
                marginTop: 'var(--space-sm)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
                cursor: isLoading ? 'wait' : 'pointer',
                fontSize: '0.875rem',
              }}
            >
              {isLoading ? 'Loading...' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
