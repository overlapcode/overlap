import { useState, useEffect } from 'react';
import { fetchWithTimeout } from '@lib/utils/fetch';
import { formatRelativeTime } from '@lib/utils/time';

type FileOperation = {
  id: number;
  session_id: string;
  user_id: string;
  timestamp: string;
  tool_name: string;
  operation: string | null;
  display_name: string;
  git_branch: string | null;
};

type FileActivityData = {
  file_path: string;
  repo_name: string;
  operations: FileOperation[];
  sessions_count: number;
  users_count: number;
};

type FileHistoryViewProps = {
  filePath: string;
  repoName: string;
};

function getToolIcon(toolName: string): string {
  switch (toolName) {
    case 'Write':
      return '✏️';
    case 'Edit':
      return '📝';
    case 'Read':
      return '📖';
    case 'Bash':
      return '▶️';
    case 'Grep':
    case 'Glob':
      return '🔍';
    default:
      return '📄';
  }
}

export function FileHistoryView({ filePath, repoName }: FileHistoryViewProps) {
  const [data, setData] = useState<FileActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchActivity() {
      if (!filePath || !repoName) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ repoName });
        const res = await fetchWithTimeout(`/api/files/${encodeURIComponent(filePath)}?${params}`);
        if (!res.ok) {
          throw new Error('Failed to fetch file activity');
        }

        const json = (await res.json()) as { data: FileActivityData };
        setData(json.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchActivity();
  }, [filePath, repoName]);

  if (!filePath || !repoName) {
    return (
      <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        <p className="text-muted">File path and repo name are required</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        <p className="text-muted">Loading file history...</p>
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

  if (!data) return null;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-lg)' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontFamily: 'var(--font-mono)' }}>{data.file_path}</h1>
        <p className="text-muted" style={{ margin: 'var(--space-xs) 0 0 0', fontFamily: 'var(--font-mono)' }}>{data.repo_name}</p>
      </div>

      {/* Stats */}
      <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-xl)' }}>
          <div>
            <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Sessions</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{data.sessions_count}</div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>People</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{data.users_count}</div>
          </div>
        </div>
        {data.users_count > 1 && (
          <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-sm)', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)' }}>
            <span style={{ color: 'var(--accent-orange)' }}>⚠️</span>
            <span className="text-secondary" style={{ marginLeft: 'var(--space-sm)', fontSize: '0.875rem' }}>
              Hot file: {data.users_count} people have modified this file recently. Consider coordinating changes.
            </span>
          </div>
        )}
      </div>

      {/* Activity timeline */}
      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-md)' }}>Recent Activity</h2>
        {data.operations.length === 0 ? (
          <p className="text-muted">No activity recorded for this file</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {data.operations.map((op) => (
              <div
                key={op.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-md)',
                  padding: 'var(--space-sm) 0',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <span style={{ fontSize: '1.25rem' }}>{getToolIcon(op.tool_name)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <span style={{ fontWeight: 500 }}>{op.display_name}</span>
                    <span className="text-muted">·</span>
                    <span className="text-secondary" style={{ fontSize: '0.875rem' }}>{op.tool_name}</span>
                    {op.git_branch && (
                      <>
                        <span className="text-muted">·</span>
                        <span className="text-muted" style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>{op.git_branch}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                  {formatRelativeTime(op.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
