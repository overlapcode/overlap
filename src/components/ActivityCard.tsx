import { useState, useEffect } from 'react';

const WAITING_MESSAGES = [
  "Warming up the keyboard...",
  "Staring at the code thoughtfully...",
  "Contemplating semicolons...",
  "Caffeinating before coding...",
  "Reading the docs (just kidding)...",
  "Googling 'how to exit vim'...",
  "Waiting for inspiration to strike...",
  "Thinking about variable names...",
  "Negotiating with the compiler...",
  "Pretending to understand the codebase...",
  "Strategically procrastinating...",
  "Loading developer motivation...",
  "Questioning life choices...",
  "Waiting for the code to write itself...",
  "In a staring contest with the cursor...",
  "Debugging thoughts...",
  "Compiling excuses...",
  "Initializing genius mode...",
  "Running git blame on past self...",
  "Summoning the mass energy of Stack Overflow...",
];

function getWaitingMessage(sessionId: string): string {
  // Simple hash to get consistent index from session ID
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash) + sessionId.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  const index = Math.abs(hash) % WAITING_MESSAGES.length;
  return WAITING_MESSAGES[index];
}

type ActivityCardProps = {
  session: {
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
};

// Parse git remote URL to GitHub web URL
function parseGitHubUrl(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;

  // Handle SSH format: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }

  // Handle HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}`;
  }

  // Handle plain HTTPS without .git
  if (remoteUrl.startsWith('https://github.com/')) {
    return remoteUrl.replace(/\.git$/, '');
  }

  return null;
}

// Get relative file path by stripping worktree prefix
function getRelativeFilePath(absolutePath: string, worktree: string | null): string {
  if (!worktree) return absolutePath;

  // Normalize paths (remove trailing slashes)
  const normalizedWorktree = worktree.replace(/\/+$/, '');

  if (absolutePath.startsWith(normalizedWorktree + '/')) {
    return absolutePath.slice(normalizedWorktree.length + 1);
  }

  return absolutePath;
}

function formatRelativeTime(dateString: string): string {
  // SQLite timestamps don't include timezone - they're UTC
  // Append 'Z' if not already present to parse as UTC
  const utcDateString = dateString.includes('Z') || dateString.includes('+')
    ? dateString
    : dateString.replace(' ', 'T') + 'Z';

  const date = new Date(utcDateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  // Handle future dates (shouldn't happen, but just in case)
  if (diffSeconds < 0) return 'just now';

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function useRelativeTime(dateString: string): string {
  const [relativeTime, setRelativeTime] = useState(() => formatRelativeTime(dateString));

  useEffect(() => {
    // Update immediately when dateString changes
    setRelativeTime(formatRelativeTime(dateString));

    // Update every 30 seconds for live timestamps
    const interval = setInterval(() => {
      setRelativeTime(formatRelativeTime(dateString));
    }, 30000);

    return () => clearInterval(interval);
  }, [dateString]);

  return relativeTime;
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
  const { user, device, repo, branch, worktree, status, last_activity_at, activity } = session;
  const relativeTime = useRelativeTime(last_activity_at);

  // GitHub URL helpers
  const githubBaseUrl = parseGitHubUrl(repo?.remote_url ?? null);
  const repoUrl = githubBaseUrl;
  const branchUrl = githubBaseUrl && branch ? `${githubBaseUrl}/tree/${branch}` : null;

  const getFileUrl = (filePath: string): string | null => {
    if (!githubBaseUrl || !branch) return null;
    const relativePath = getRelativeFilePath(filePath, worktree);
    // Encode each path segment to handle special chars like (), [], etc.
    const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
    return `${githubBaseUrl}/blob/${branch}/${encodedPath}`;
  };

  return (
    <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 'var(--space-md)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{user.name}</span>
          <span className="text-muted">·</span>
          <span className="text-secondary">{device.name}</span>
          {device.is_remote && (
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>(remote)</span>
          )}
          <span className="text-muted">·</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className={`status-dot ${status}`} />
            <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
              {getStatusLabel(status)}
            </span>
          </span>
          <span className="text-muted" style={{ fontSize: '0.875rem' }}>
            {relativeTime}
          </span>
        </div>
      </div>

      {/* Activity content or empty state */}
      {activity ? (
        <>
          {/* Semantic scope badge */}
          {activity.semantic_scope && (
            <div style={{ marginBottom: 'var(--space-sm)' }}>
              <span className="scope-badge">{activity.semantic_scope}</span>
            </div>
          )}

          {/* Summary */}
          {activity.summary && (
            <p className="text-primary" style={{ marginBottom: 'var(--space-md)' }}>
              {activity.summary}
            </p>
          )}

          {/* Files */}
          {activity.files && activity.files.length > 0 && (
            <div className="files-list">
              {activity.files.slice(0, 5).map((file, i) => {
                const fileUrl = getFileUrl(file);
                const fileName = file.split('/').pop();
                return fileUrl ? (
                  <a
                    key={i}
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="file-tag file-tag-link"
                    title={getRelativeFilePath(file, worktree)}
                  >
                    {fileName}
                  </a>
                ) : (
                  <span key={i} className="file-tag" title={file}>
                    {fileName}
                  </span>
                );
              })}
              {activity.files.length > 5 && (
                <span className="text-muted">+{activity.files.length - 5} more</span>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-muted" style={{ fontStyle: 'italic' }}>
          {getWaitingMessage(session.id)}
        </p>
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
          {branch && (
            branchUrl ? (
              <a href={branchUrl} target="_blank" rel="noopener noreferrer" className="footer-link">
                {branch}
              </a>
            ) : (
              <span>{branch}</span>
            )
          )}
          {branch && repo && <span> · </span>}
          {repo && (
            repoUrl ? (
              <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="footer-link">
                {repo.name}
              </a>
            ) : (
              <span>{repo.name}</span>
            )
          )}
        </div>
      )}
    </div>
  );
}
