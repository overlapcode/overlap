import { useState, useEffect } from 'react';
import { fetchWithTimeout } from '@lib/utils/fetch';
import { formatRelativeTime } from '@lib/utils/time';

type Overlap = {
  id: number;
  type: 'file' | 'prompt' | 'directory';
  severity: 'info' | 'warning';
  file_path: string | null;
  directory_path: string | null;
  repo_name: string;
  user_id_a: string;
  user_id_b: string;
  session_id_a: string | null;
  session_id_b: string | null;
  description: string | null;
  detected_at: string;
  member_a_name: string;
  member_b_name: string;
};

function getOverlapIcon(type: string): string {
  switch (type) {
    case 'file':
      return '🔄';
    case 'prompt':
      return '🔍';
    case 'directory':
      return '📁';
    default:
      return '⚠️';
  }
}

function getOverlapTitle(overlap: Overlap): string {
  switch (overlap.type) {
    case 'file':
      return `File overlap`;
    case 'prompt':
      return `Similar work`;
    case 'directory':
      return `Hot directory`;
    default:
      return 'Overlap detected';
  }
}

export function OverlapsView() {
  const [overlaps, setOverlaps] = useState<Overlap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    async function fetchOverlaps() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ days: String(days) });
        const res = await fetchWithTimeout(`/api/overlaps?${params}`);
        if (!res.ok) {
          throw new Error('Failed to fetch overlaps');
        }

        const data = (await res.json()) as { data: { overlaps: Overlap[] } };
        setOverlaps(data.data.overlaps);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchOverlaps();
  }, [days]);

  if (loading) {
    return (
      <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        <p className="text-muted">Loading overlaps...</p>
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

  return (
    <div>
      {/* Header with filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Overlaps</h1>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={days === d ? 'btn btn-primary' : 'btn btn-secondary'}
              style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
            >
              {d === 7 ? 'This Week' : d === 14 ? '2 Weeks' : 'This Month'}
            </button>
          ))}
        </div>
      </div>

      {/* Overlaps list */}
      {overlaps.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
          <p style={{ fontSize: '2rem', marginBottom: 'var(--space-sm)' }}>🎉</p>
          <p className="text-muted">No overlaps detected in the last {days} days</p>
          <p className="text-secondary" style={{ fontSize: '0.875rem' }}>Your team is working on different areas!</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {overlaps.map((overlap) => (
            <div
              key={overlap.id}
              className="card"
              style={{
                borderLeft: overlap.severity === 'warning' ? '3px solid var(--accent-orange)' : '3px solid var(--accent-blue)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-md)' }}>
                <span style={{ fontSize: '1.5rem' }}>{getOverlapIcon(overlap.type)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                    <span style={{ fontWeight: 600 }}>{getOverlapTitle(overlap)}</span>
                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                      {formatRelativeTime(overlap.detected_at)}
                    </span>
                  </div>

                  {overlap.file_path && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', marginBottom: 'var(--space-sm)' }}>
                      {overlap.file_path}
                    </div>
                  )}

                  <div className="text-secondary" style={{ fontSize: '0.875rem', marginBottom: 'var(--space-xs)' }}>
                    <strong>{overlap.member_a_name}</strong> and <strong>{overlap.member_b_name}</strong>
                  </div>

                  {overlap.description && (
                    <p className="text-muted" style={{ fontSize: '0.875rem', margin: 0 }}>
                      {overlap.description}
                    </p>
                  )}

                  <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 'var(--space-sm)', fontFamily: 'var(--font-mono)' }}>
                    {overlap.repo_name}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
