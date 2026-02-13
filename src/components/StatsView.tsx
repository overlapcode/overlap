import { useState, useEffect } from 'react';
import { fetchWithTimeout } from '@lib/utils/fetch';

type TeamStats = {
  total_sessions: number;
  total_cost_usd: number;
  total_files: number;
  avg_duration_ms: number;
  by_member: Array<{
    user_id: string;
    display_name: string;
    session_count: number;
    total_cost: number;
  }>;
  by_repo: Array<{
    repo_name: string;
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
    session_count: number;
    user_count: number;
  }>;
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

export function StatsView() {
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month'>('week');

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Team Analytics</h1>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          {(['today', 'week', 'month'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={dateRange === range ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
            >
              {range === 'today' ? 'Today' : range === 'week' ? 'This Week' : 'This Month'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Sessions</div>
          <div style={{ fontSize: '2rem', fontWeight: 600 }}>{stats.total_sessions}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Total Cost</div>
          <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--accent-green)' }}>{formatCost(stats.total_cost_usd)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Avg Duration</div>
          <div style={{ fontSize: '2rem', fontWeight: 600 }}>{formatDuration(stats.avg_duration_ms)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Files Touched</div>
          <div style={{ fontSize: '2rem', fontWeight: 600 }}>{stats.total_files}</div>
        </div>
      </div>

      {/* By member */}
      <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-md)' }}>By Member</h2>
        {stats.by_member.length === 0 ? (
          <p className="text-muted">No sessions in this period</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {stats.by_member.map((m) => (
              <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 500 }}>{m.display_name}</span>
                </div>
                <span className="text-secondary" style={{ fontSize: '0.875rem' }}>{m.session_count} sessions</span>
                <span style={{ fontSize: '0.875rem', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>
                  {formatCost(m.total_cost)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* By repo */}
      <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-md)' }}>By Repository</h2>
        {stats.by_repo.length === 0 ? (
          <p className="text-muted">No sessions in this period</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {stats.by_repo.map((r) => (
              <div key={r.repo_name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                <div style={{ flex: 1, fontFamily: 'var(--font-mono)' }}>
                  <span>{r.repo_name}</span>
                </div>
                <span className="text-secondary" style={{ fontSize: '0.875rem' }}>{r.session_count} sessions</span>
                <span style={{ fontSize: '0.875rem', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>
                  {formatCost(r.total_cost)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* By model */}
      <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-md)' }}>Model Usage</h2>
        {stats.by_model.length === 0 ? (
          <p className="text-muted">No sessions in this period</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {stats.by_model.map((m) => (
              <div key={m.model} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                <div style={{ flex: 1 }}>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--bg-elevated)',
                      color: 'var(--accent-blue)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {m.model}
                  </span>
                </div>
                <span className="text-secondary" style={{ fontSize: '0.875rem' }}>{m.session_count} sessions</span>
                <span style={{ fontSize: '0.875rem', color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>
                  {formatCost(m.total_cost)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hottest files */}
      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-md)' }}>Hottest Files</h2>
        {stats.hottest_files.length === 0 ? (
          <p className="text-muted">No file activity in this period</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {stats.hottest_files.map((f, i) => (
              <div key={f.file_path} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                <span className="text-muted" style={{ fontSize: '0.75rem', width: '1.5rem' }}>{i + 1}.</span>
                <div style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {f.file_path}
                </div>
                <span className="text-secondary" style={{ fontSize: '0.75rem' }}>{f.session_count} sessions</span>
                <span className="text-muted" style={{ fontSize: '0.75rem' }}>{f.user_count} people</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
