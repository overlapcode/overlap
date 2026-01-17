type ActivityCardProps = {
  session: {
    id: string;
    user: { id: string; name: string };
    device: { id: string; name: string; is_remote: boolean };
    repo: { id: string; name: string } | null;
    branch: string | null;
    status: 'active' | 'stale' | 'ended';
    started_at: string;
    last_activity_at: string;
    activity: {
      semantic_scope: string | null;
      summary: string | null;
      files: string[];
    } | null;
  };
};

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'active': return 'ACTIVE';
    case 'stale': return 'STALE';
    case 'ended': return 'ENDED';
    default: return status.toUpperCase();
  }
}

export function ActivityCard({ session }: ActivityCardProps) {
  const { user, device, repo, branch, status, last_activity_at, activity } = session;

  return (
    <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 'var(--space-md)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <span style={{ fontWeight: 600 }}>{user.name}</span>
          <span className="text-muted">·</span>
          <span className="text-secondary">{device.name}</span>
          {device.is_remote && (
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>(remote)</span>
          )}
          <span className="text-muted">·</span>
          <span className={`status-dot ${status}`} />
          <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
            {getStatusLabel(status)}
          </span>
        </div>
        <span className="text-muted" style={{ fontSize: '0.875rem' }}>
          {formatRelativeTime(last_activity_at)}
        </span>
      </div>

      {/* Semantic scope badge */}
      {activity?.semantic_scope && (
        <div style={{ marginBottom: 'var(--space-sm)' }}>
          <span className="scope-badge">{activity.semantic_scope}</span>
        </div>
      )}

      {/* Summary */}
      {activity?.summary && (
        <p className="text-primary" style={{ marginBottom: 'var(--space-md)' }}>
          {activity.summary}
        </p>
      )}

      {/* Files */}
      {activity?.files && activity.files.length > 0 && (
        <div className="files-list">
          {activity.files.slice(0, 5).map((file, i) => (
            <span key={i} className="file-tag">
              {file.split('/').pop()}
            </span>
          ))}
          {activity.files.length > 5 && (
            <span className="text-muted">+{activity.files.length - 5} more</span>
          )}
        </div>
      )}

      {/* Footer */}
      {(branch || repo) && (
        <div
          className="text-muted"
          style={{
            marginTop: 'var(--space-md)',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-mono)'
          }}
        >
          {branch && <span>{branch}</span>}
          {branch && repo && <span> · </span>}
          {repo && <span>{repo.name}</span>}
        </div>
      )}
    </div>
  );
}
