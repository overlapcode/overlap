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

function buildSummary(overlap: Overlap): string {
  const scope = overlap.overlap_scope;
  const a = overlap.member_a_name;
  const b = overlap.member_b_name;

  if (scope === 'line' && overlap.function_name) {
    return `${a} and ${b} both edited ${overlap.function_name}() at lines ${overlap.start_line}–${overlap.end_line}`;
  }
  if (scope === 'line' && overlap.start_line != null) {
    return `${a} and ${b} both edited lines ${overlap.start_line}–${overlap.end_line ?? overlap.start_line}`;
  }
  if (scope === 'function' && overlap.function_name) {
    return `${a} and ${b} both modified the ${overlap.function_name}() function`;
  }
  if (scope === 'file' && overlap.file_path) {
    return `${a} and ${b} both edited this file in the same session`;
  }
  return `${a} and ${b} worked in the same area`;
}

function OverlapCard({ overlap }: { overlap: Overlap }) {
  const href = `/overlap/${overlap.public_id ?? overlap.id}`;
  const decisionStyle = overlap.decision ? DECISION_STYLES[overlap.decision] : null;
  const summary = buildSummary(overlap);

  return (
    <a href={href} className="card-link">
      <div className="card" style={{ cursor: 'pointer' }}>
        {/* Row 1: Users + time */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>
              {overlap.member_a_name}
            </span>
            <span className="text-muted">and</span>
            <span style={{ fontWeight: 600 }}>
              {overlap.member_b_name}
            </span>
          </div>
          <span className="text-muted" style={{ fontSize: '0.75rem', flexShrink: 0 }}>
            {formatRelativeTime(overlap.detected_at)}
          </span>
        </div>

        {/* Row 2: Summary text */}
        <p className="text-primary" style={{ margin: '0 0 var(--space-sm)', fontSize: '0.875rem' }}>
          {summary}
        </p>

        {/* Row 3: File path as a tag */}
        {overlap.file_path && (
          <div style={{ marginBottom: 'var(--space-sm)' }}>
            <span style={{
              display: 'inline-block',
              fontSize: '0.75rem',
              padding: '2px 8px',
              borderRadius: '4px',
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {overlap.file_path}
              {overlap.start_line != null && overlap.end_line != null && (
                ` L${overlap.start_line}–${overlap.end_line}`
              )}
            </span>
          </div>
        )}

        {/* Row 4: Guidance preview (truncated) */}
        {overlap.description && (
          <p className="text-muted" style={{
            margin: '0 0 var(--space-sm)',
            fontSize: '0.8125rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {overlap.description.split('\n')[0]}
          </p>
        )}

        {/* Row 5: Badges + repo footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-xs)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '0.6875rem',
              padding: '1px 6px',
              borderRadius: '4px',
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              {SCOPE_LABELS[overlap.overlap_scope] ?? 'overlap'}
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
            <span className="text-muted" style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
              {overlap.repo_name}
            </span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--accent-blue)', flexShrink: 0 }}>
            View details →
          </span>
        </div>
      </div>
    </a>
  );
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
            <OverlapCard key={overlap.id} overlap={overlap} />
          ))}
        </div>
      )}
    </div>
  );
}
