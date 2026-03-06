import { useState, useEffect } from 'react';
import { fetchWithTimeout } from '@lib/utils/fetch';
import { parseGitHubUrl, deriveGitHubUrl, stripRepoRoot } from '@lib/utils/github';

type TeamStats = {
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

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

/** Shared row style for table-like lists */
const tableRowStyle = (index: number): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-md)',
  padding: 'var(--space-sm) var(--space-md)',
  backgroundColor: index % 2 === 0 ? 'transparent' : 'var(--bg-primary)',
  borderRadius: 'var(--radius-sm)',
  transition: 'background-color 0.15s',
});

function getModelColor(model: string | null | undefined): string {
  if (!model) return 'var(--accent-blue)';
  const lower = model.toLowerCase();
  if (lower.includes('sonnet')) return 'var(--accent-green)';
  if (lower.includes('opus')) return 'var(--accent-blue)';
  if (lower.includes('haiku')) return 'var(--accent-gold)';
  return 'var(--accent-blue)';
}

export function StatsView() {
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('week');

  useEffect(() => {
    async function fetchStats() {
      setLoading(true);
      setError(null);

      try {
        const now = new Date();
        let startDate: string | undefined;

        switch (dateRange) {
          case 'today':
            startDate = now.toISOString().split('T')[0];
            break;
          case 'week':
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            startDate = weekAgo.toISOString().split('T')[0];
            break;
          case 'month':
            const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            startDate = monthAgo.toISOString().split('T')[0];
            break;
          case 'all':
            startDate = undefined;
            break;
        }

        const params = new URLSearchParams();
        if (startDate) params.set('startDate', startDate);

        const res = await fetchWithTimeout(`/api/stats?${params}`);
        if (!res.ok) {
          throw new Error('Failed to fetch stats');
        }

        const data = (await res.json()) as { data: TeamStats };
        setStats(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [dateRange]);

  if (loading) {
    return (
      <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        <p className="text-muted">Loading stats...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        <p className="text-muted">Error: {error}</p>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div>
      {/* Header with date selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Team Analytics</h1>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          {(['today', 'week', 'month', 'all'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={dateRange === range ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
            >
              {range === 'today' ? 'Today' : range === 'week' ? 'This Week' : range === 'month' ? 'This Month' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards — 6 cards in 3x2 grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Sessions</div>
          <div style={{ fontSize: '2rem', fontWeight: 600 }}>{stats.total_sessions}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Total Cost</div>
          <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--accent-green)' }}>{formatCost(stats.total_cost_usd)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Tokens Used</div>
          <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--accent-blue)' }}>
            {formatTokens(stats.total_input_tokens + stats.total_output_tokens)}
          </div>
          <div className="text-muted" style={{ fontSize: '0.625rem', marginTop: '2px' }}>
            {formatTokens(stats.total_input_tokens)} in · {formatTokens(stats.total_output_tokens)} out
          </div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Avg Duration</div>
          <div style={{ fontSize: '2rem', fontWeight: 600 }}>{formatDuration(stats.avg_duration_ms)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Files Touched</div>
          <div style={{ fontSize: '2rem', fontWeight: 600 }}>{stats.total_files}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Est. Savings</div>
          <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--accent-orange)' }}>
            {stats.savings.estimated_savings_usd < 0.01 ? '$0.00' : `$${stats.savings.estimated_savings_usd.toFixed(2)}`}
          </div>
          <div className="text-muted" style={{ fontSize: '0.625rem', marginTop: '2px' }}>
            {stats.savings.block_count} blocked · {stats.savings.warn_count} warned
          </div>
        </div>
      </div>

      {/* By member + By repo (side-by-side) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
        <div className="card" style={{ padding: 'var(--space-md) 0' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-md)', padding: '0 var(--space-md)' }}>By Member</h2>
          {stats.by_member.length === 0 ? (
            <p className="text-muted" style={{ padding: '0 var(--space-md)' }}>No sessions in this period</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {stats.by_member.map((m, i) => (
                <a
                  key={m.user_id}
                  href={`/?userId=${encodeURIComponent(m.user_id)}`}
                  className="stats-row"
                  style={{ ...tableRowStyle(i), textDecoration: 'none', color: 'inherit' }}
                >
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 500, color: 'var(--accent-blue)' }}>{m.display_name}</span>
                  </div>
                  <span className="text-secondary" style={{ fontSize: '0.875rem', width: '6rem', textAlign: 'right' }}>{m.session_count} {m.session_count === 1 ? 'session' : 'sessions'}</span>
                  <span style={{ fontSize: '0.875rem', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)', width: '5rem', textAlign: 'right' }}>
                    {formatCost(m.total_cost)}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 'var(--space-md) 0' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-md)', padding: '0 var(--space-md)' }}>By Repository</h2>
          {stats.by_repo.length === 0 ? (
            <p className="text-muted" style={{ padding: '0 var(--space-md)' }}>No sessions in this period</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {stats.by_repo.map((r, i) => {
                const ghUrl = parseGitHubUrl(r.remote_url) ?? deriveGitHubUrl(r.repo_name);
                return (
                  <div key={r.repo_name} className="stats-row" style={tableRowStyle(i)}>
                    <div style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ghUrl ? (
                        <a href={ghUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{r.repo_name}</a>
                      ) : r.repo_id ? (
                        <a href={`/repo/${r.repo_id}`} style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{r.repo_name}</a>
                      ) : (
                        <span>{r.repo_name}</span>
                      )}
                    </div>
                    <span className="text-secondary" style={{ fontSize: '0.875rem', width: '6rem', textAlign: 'right' }}>{r.session_count} {r.session_count === 1 ? 'session' : 'sessions'}</span>
                    <span style={{ fontSize: '0.875rem', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)', width: '5rem', textAlign: 'right' }}>
                      {formatCost(r.total_cost)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Model usage + Hottest files (side-by-side) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 'var(--space-lg)' }}>
        <div className="card" style={{ padding: 'var(--space-md) 0' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-md)', padding: '0 var(--space-md)' }}>Model Usage</h2>
          {stats.by_model.length === 0 ? (
            <p className="text-muted" style={{ padding: '0 var(--space-md)' }}>No sessions in this period</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {stats.by_model.map((m, i) => (
                <div key={m.model} className="stats-row" style={tableRowStyle(i)}>
                  <div style={{ flex: 1 }}>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--bg-elevated)',
                        color: getModelColor(m.model),
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {m.model}
                    </span>
                  </div>
                  <span className="text-secondary" style={{ fontSize: '0.875rem', width: '6rem', textAlign: 'right' }}>{m.session_count} {m.session_count === 1 ? 'session' : 'sessions'}</span>
                  <span style={{ fontSize: '0.875rem', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)', width: '5rem', textAlign: 'right' }}>
                    {formatCost(m.total_cost)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 'var(--space-md) 0' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-md)', padding: '0 var(--space-md)' }}>Hottest Files</h2>
          {stats.hottest_files.length === 0 ? (
            <p className="text-muted" style={{ padding: '0 var(--space-md)' }}>No file activity in this period</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {stats.hottest_files.map((f, i) => {
                const ghUrl = parseGitHubUrl(f.remote_url) ?? deriveGitHubUrl(f.repo_name);
                const relativePath = stripRepoRoot(f.file_path, f.repo_name);
                const fileUrl = ghUrl ? `${ghUrl}/blob/main/${relativePath.split('/').map(encodeURIComponent).join('/')}` : null;
                return (
                  <div key={`${f.repo_name}:${f.file_path}`} className="stats-row" style={tableRowStyle(i)}>
                    <span className="text-muted" style={{ fontSize: '0.75rem', width: '1.5rem', flexShrink: 0 }}>{i + 1}.</span>
                    <div style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fileUrl ? (
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{f.file_path}</a>
                      ) : (
                        <span>{f.file_path}</span>
                      )}
                      <span className="text-muted" style={{ fontSize: '0.6875rem', marginLeft: 'var(--space-xs)' }}>{f.repo_name}</span>
                    </div>
                    <span className="text-secondary" style={{ fontSize: '0.75rem', width: '5.5rem', textAlign: 'right', flexShrink: 0 }}>{f.session_count} {f.session_count === 1 ? 'session' : 'sessions'}</span>
                    <span className="text-muted" style={{ fontSize: '0.75rem', width: '4.5rem', textAlign: 'right', flexShrink: 0 }}>{f.user_count} {f.user_count === 1 ? 'person' : 'people'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
