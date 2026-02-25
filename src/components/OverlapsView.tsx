import { useState, useEffect } from 'react';
import { fetchWithTimeout } from '@lib/utils/fetch';
import { formatRelativeTime } from '@lib/utils/time';

type Overlap = {
  id: number;
  type: 'file' | 'prompt' | 'directory';
  severity: 'info' | 'warning' | 'high';
  overlap_scope: 'line' | 'function' | 'file' | 'directory';
  file_path: string | null;
  directory_path: string | null;
  start_line: number | null;
  end_line: number | null;
  function_name: string | null;
  repo_name: string;
  user_id_a: string;
  user_id_b: string;
  session_id_a: string | null;
  session_id_b: string | null;
  description: string | null;
  decision: 'block' | 'warn' | null;
  public_id: string | null;
  detected_at: string;
  member_a_name: string;
  member_b_name: string;
};

const SEVERITY_COLORS: Record<string, string> = {
  high: 'var(--accent-orange)',
  warning: 'var(--accent-orange)',
  info: 'var(--accent-blue)',
};

const SCOPE_LABELS: Record<string, string> = {
  line: 'Line overlap',
  function: 'Function overlap',
  file: 'File overlap',
  directory: 'Directory overlap',
};

const DECISION_STYLES: Record<string, { label: string; color: string }> = {
  block: { label: 'BLOCKED', color: '#d95757' },
  warn: { label: 'WARNED', color: 'var(--accent-orange)' },
};

function getSeverityColor(severity: string): string {
  return SEVERITY_COLORS[severity] ?? 'var(--accent-blue)';
}

function getScopeLabel(overlap: Overlap): string {
  return SCOPE_LABELS[overlap.overlap_scope] ?? 'Overlap detected';
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
          {overlaps.map((overlap) => {
            const color = getSeverityColor(overlap.severity);
            const decisionStyle = overlap.decision ? DECISION_STYLES[overlap.decision] : null;
            const href = overlap.public_id ? `/overlap/${overlap.public_id}` : null;

            const card = (
              <div
                className="card"
                style={{
                  borderLeft: `3px solid ${color}`,
                  cursor: href ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-md)' }}>
                  <div style={{ flex: 1 }}>
                    {/* Title row: scope label + severity + decision + time */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{getScopeLabel(overlap)}</span>
                      <span style={{
                        fontSize: '0.6875rem',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--bg-primary)',
                        border: `1px solid ${color}`,
                        color: color,
                        fontFamily: 'var(--font-mono)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}>
                        {overlap.severity}
                      </span>
                      {decisionStyle && (
                        <span style={{
                          fontSize: '0.6875rem',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          backgroundColor: 'var(--bg-primary)',
                          border: `1px solid ${decisionStyle.color}`,
                          color: decisionStyle.color,
                          fontFamily: 'var(--font-mono)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}>
                          {decisionStyle.label}
                        </span>
                      )}
                      <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {formatRelativeTime(overlap.detected_at)}
                      </span>
                    </div>

                    {/* File path + line/function detail */}
                    {overlap.file_path && (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', marginBottom: 'var(--space-sm)' }}>
                        <span>{overlap.file_path}</span>
                        {overlap.function_name && (
                          <span className="text-muted"> : {overlap.function_name}()</span>
                        )}
                        {overlap.start_line != null && overlap.end_line != null && (
                          <span className="text-muted">
                            {' '}L{overlap.start_line}–{overlap.end_line}
                          </span>
                        )}
                        {overlap.start_line != null && overlap.end_line == null && (
                          <span className="text-muted"> L{overlap.start_line}</span>
                        )}
                      </div>
                    )}

                    {/* Users involved */}
                    <div className="text-secondary" style={{ fontSize: '0.875rem', marginBottom: 'var(--space-xs)' }}>
                      <strong>{overlap.member_a_name}</strong>
                      <span> and </span>
                      <strong>{overlap.member_b_name}</strong>
                    </div>

                    {/* Repo */}
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 'var(--space-sm)', fontFamily: 'var(--font-mono)' }}>
                      {overlap.repo_name}
                    </div>
                  </div>

                  {/* Arrow indicator */}
                  {href && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '1.25rem',
                      flexShrink: 0,
                      paddingTop: 'var(--space-xs)',
                    }}>
                      →
                    </div>
                  )}
                </div>

                {/* View details footer */}
                {href && (
                  <div style={{
                    marginTop: 'var(--space-sm)',
                    paddingTop: 'var(--space-sm)',
                    borderTop: '1px solid var(--border-subtle)',
                    fontSize: '0.75rem',
                    color: 'var(--accent-blue)',
                  }}>
                    View details →
                  </div>
                )}
              </div>
            );

            if (href) {
              return (
                <a key={overlap.id} href={href} className="card-link">
                  {card}
                </a>
              );
            }

            return <div key={overlap.id}>{card}</div>;
          })}
        </div>
      )}
    </div>
  );
}
