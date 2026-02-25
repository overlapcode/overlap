import { useState, useEffect } from 'react';
import { fetchWithTimeout } from '@lib/utils/fetch';
import { formatRelativeTime } from '@lib/utils/time';

type FileOp = {
  id: number;
  session_id: string;
  user_id: string;
  timestamp: string;
  tool_name: string | null;
  file_path: string | null;
  operation: string | null;
  start_line: number | null;
  end_line: number | null;
  function_name: string | null;
  old_string: string | null;
  new_string: string | null;
};

type OverlapData = {
  id: number;
  type: string;
  severity: string;
  overlap_scope: string;
  file_path: string | null;
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
  detected_at: string;
  member_a_name: string;
  member_b_name: string;
  edits_a: FileOp[];
  edits_b: FileOp[];
  first_user: 'a' | 'b';
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

const USER_COLORS = {
  a: 'var(--accent-orange)',
  b: 'var(--accent-blue)',
};

const DECISION_DISPLAY: Record<string, { label: string; color: string; description: string }> = {
  block: { label: 'BLOCKED', color: '#d95757', description: 'The overlapping user was blocked from editing this region' },
  warn: { label: 'WARNED', color: 'var(--accent-orange)', description: 'The overlapping user was warned about this conflict' },
};

function CodeBlock({ label, code, borderColor }: { label: string; code: string; borderColor: string }) {
  return (
    <div style={{ marginTop: 'var(--space-xs)' }}>
      <span style={{
        fontSize: '0.6875rem',
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {label}
      </span>
      <pre style={{
        margin: '2px 0 0',
        padding: 'var(--space-sm) var(--space-md)',
        backgroundColor: 'var(--bg-primary)',
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.8125rem',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: '300px',
        overflowY: 'auto',
        color: 'var(--text-secondary)',
      }}>
        {code}
      </pre>
    </div>
  );
}

function EditCard({ edit }: { edit: FileOp }) {
  return (
    <div style={{
      padding: 'var(--space-md)',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      {/* Header: time + tool */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)', flexWrap: 'wrap' }}>
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>
          {formatRelativeTime(edit.timestamp)}
        </span>
        {edit.tool_name && (
          <span style={{
            fontSize: '0.6875rem',
            padding: '1px 6px',
            borderRadius: '4px',
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            {edit.tool_name}
          </span>
        )}
      </div>

      {/* Line/function context */}
      {(edit.start_line != null || edit.function_name) && (
        <div className="text-muted" style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', marginBottom: 'var(--space-sm)' }}>
          {edit.function_name && <span>{edit.function_name}()</span>}
          {edit.function_name && edit.start_line != null && <span> · </span>}
          {edit.start_line != null && edit.end_line != null && (
            <span>L{edit.start_line}–{edit.end_line}</span>
          )}
          {edit.start_line != null && edit.end_line == null && (
            <span>L{edit.start_line}</span>
          )}
        </div>
      )}

      {/* Code blocks */}
      {edit.old_string && (
        <CodeBlock label="Removed" code={edit.old_string} borderColor="#d9575766" />
      )}
      {edit.new_string && (
        <CodeBlock label="Added" code={edit.new_string} borderColor="#788c5d88" />
      )}
      {!edit.old_string && !edit.new_string && (
        <p className="text-muted" style={{ fontSize: '0.8125rem', fontStyle: 'italic', margin: 0 }}>
          No diff content recorded
        </p>
      )}
    </div>
  );
}

function UserEditsSection({ edits, userName, userColor, isFirst, sessionId }: {
  edits: FileOp[];
  userName: string;
  userColor: string;
  isFirst: boolean;
  sessionId: string | null;
}) {
  return (
    <div style={{ marginBottom: 'var(--space-lg)' }}>
      {/* Section header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-sm)',
        marginBottom: 'var(--space-sm)',
        paddingLeft: 'var(--space-sm)',
        flexWrap: 'wrap',
      }}>
        <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: userColor, display: 'inline-block', flexShrink: 0 }} />
        {sessionId ? (
          <a href={`/session/${sessionId}`} className="footer-link" style={{ fontWeight: 600, fontSize: '1rem' }}>
            {userName}
          </a>
        ) : (
          <strong style={{ fontSize: '1rem' }}>{userName}</strong>
        )}
        <span style={{
          fontSize: '0.6875rem',
          padding: '1px 6px',
          borderRadius: '4px',
          backgroundColor: 'var(--bg-primary)',
          border: `1px solid ${isFirst ? 'var(--accent-green)' : 'var(--accent-orange)'}`,
          color: isFirst ? 'var(--accent-green)' : 'var(--accent-orange)',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {isFirst ? 'edited first' : 'overlapping'}
        </span>
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>
          {edits.length} {edits.length === 1 ? 'edit' : 'edits'}
        </span>
      </div>

      {/* Edits */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: `3px solid ${userColor}` }}>
        {edits.length > 0 ? (
          edits.map((edit) => (
            <EditCard key={edit.id} edit={edit} />
          ))
        ) : (
          <div style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>
            <p className="text-muted" style={{ fontStyle: 'italic', margin: 0 }}>
              No edit content recorded
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function OverlapHeader({ data }: { data: OverlapData }) {
  const color = SEVERITY_COLORS[data.severity] ?? 'var(--accent-blue)';

  return (
    <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
      {/* Scope + severity + time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: '1.125rem' }}>
          {SCOPE_LABELS[data.overlap_scope] ?? 'Overlap'}
        </span>
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
          {data.severity}
        </span>
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>
          {formatRelativeTime(data.detected_at)}
        </span>
      </div>

      {/* File path + context */}
      {data.file_path && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', marginBottom: 'var(--space-md)' }}>
          <span>{data.file_path}</span>
          {data.function_name && (
            <span className="text-muted"> : {data.function_name}()</span>
          )}
          {data.start_line != null && data.end_line != null && (
            <span className="text-muted"> L{data.start_line}–{data.end_line}</span>
          )}
        </div>
      )}

      {/* Repo */}
      <div className="text-muted" style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
        {data.repo_name}
      </div>
    </div>
  );
}

export function OverlapDetail({ overlapId }: { overlapId: string }) {
  const [data, setData] = useState<OverlapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDetail() {
      setLoading(true);
      try {
        const res = await fetchWithTimeout(`/api/overlaps/${overlapId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError('Overlap not found');
            return;
          }
          throw new Error('Failed to fetch overlap detail');
        }
        const json = (await res.json()) as { data: OverlapData };
        setData(json.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchDetail();
  }, [overlapId]);

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
        <img src="/loading.gif" alt="Loading" width={48} height={48} style={{ opacity: 0.8 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
        <p style={{ color: 'var(--accent-orange)', marginBottom: 'var(--space-md)' }}>{error}</p>
        <a href="/overlaps" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontSize: '0.875rem' }}>
          &larr; Back to Overlaps
        </a>
      </div>
    );
  }

  if (!data) return null;

  const firstIsA = data.first_user === 'a';
  const decisionInfo = data.decision ? DECISION_DISPLAY[data.decision] : null;

  return (
    <div>
      <OverlapHeader data={data} />

      {/* Decision + Guidance */}
      {(decisionInfo || data.description) && (
        <div className="card" style={{
          marginBottom: 'var(--space-lg)',
          borderLeft: `3px solid ${decisionInfo?.color ?? 'var(--accent-orange)'}`,
          padding: 'var(--space-md)',
        }}>
          {decisionInfo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: data.description ? 'var(--space-sm)' : 0 }}>
              <span style={{
                fontSize: '0.6875rem',
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: 'var(--bg-primary)',
                border: `1px solid ${decisionInfo.color}`,
                color: decisionInfo.color,
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {decisionInfo.label}
              </span>
              <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                {decisionInfo.description}
              </span>
            </div>
          )}
          {data.description && (
            <>
              <span style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'block',
                marginBottom: 'var(--space-xs)',
              }}>
                Guidance sent to overlapping user
              </span>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                {data.description}
              </p>
            </>
          )}
        </div>
      )}

      {/* User A's edits (first user shown first) */}
      <UserEditsSection
        edits={firstIsA ? data.edits_a : data.edits_b}
        userName={firstIsA ? data.member_a_name : data.member_b_name}
        userColor={firstIsA ? USER_COLORS.a : USER_COLORS.b}
        isFirst={true}
        sessionId={firstIsA ? data.session_id_a : data.session_id_b}
      />

      {/* User B's edits (overlapping user) */}
      <UserEditsSection
        edits={firstIsA ? data.edits_b : data.edits_a}
        userName={firstIsA ? data.member_b_name : data.member_a_name}
        userColor={firstIsA ? USER_COLORS.b : USER_COLORS.a}
        isFirst={false}
        sessionId={firstIsA ? data.session_id_b : data.session_id_a}
      />
    </div>
  );
}
