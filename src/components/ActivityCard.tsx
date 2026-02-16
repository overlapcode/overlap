import { memo, useState } from 'react';
import { useRelativeTime, formatRelativeTime } from '@lib/utils/time';
import { parseGitHubUrl, getRelativeFilePath, getStatusLabel, getAgentLabel, getFileUrl, getBranchUrl } from '@lib/utils/github';
import { fetchWithTimeout } from '@lib/utils/fetch';

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
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash) + sessionId.charCodeAt(i);
    hash = hash & hash;
  }
  const index = Math.abs(hash) % WAITING_MESSAGES.length;
  return WAITING_MESSAGES[index];
}

type CompactActivity = {
  id: string;
  semantic_scope: string | null;
  summary: string | null;
  files: string[];
  created_at: string;
};

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
    // v2 fields
    agent_type?: string;
    model?: string | null;
    total_cost_usd?: number | null;
    num_turns?: number;
    duration_ms?: number | null;
    activity: {
      semantic_scope: string | null;
      summary: string | null;
      files: string[];
    } | null;
  };
};

/**
 * Format cost as a readable string
 */
function formatCost(cost: number | null | undefined): string | null {
  if (cost === null || cost === undefined || cost === 0) return null;
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

/**
 * Get a short model name for display
 */
function getModelLabel(model: string | null | undefined): string | null {
  if (!model) return null;
  // Extract the model family name
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes('opus')) return 'Opus';
  if (lowerModel.includes('sonnet')) return 'Sonnet';
  if (lowerModel.includes('haiku')) return 'Haiku';
  if (lowerModel.includes('gpt-4')) return 'GPT-4';
  if (lowerModel.includes('gpt-3')) return 'GPT-3.5';
  if (lowerModel.includes('claude')) return 'Claude';
  // Return first part if unknown
  return model.split('-')[0];
}

export const ActivityCard = memo(function ActivityCard({ session }: ActivityCardProps) {
  const { user, device, repo, branch, worktree, status, last_activity_at, activity, model, total_cost_usd, num_turns, agent_type } = session;
  const relativeTime = useRelativeTime(last_activity_at || session.started_at);
  const costLabel = formatCost(total_cost_usd);
  const modelLabel = getModelLabel(model);
  const agentLabel = getAgentLabel(agent_type);

  const [expanded, setExpanded] = useState(false);
  const [recentActivities, setRecentActivities] = useState<CompactActivity[] | null>(null);
  const [loadingActivities, setLoadingActivities] = useState(false);

  // GitHub URL helpers
  const githubBaseUrl = parseGitHubUrl(repo?.remote_url ?? null);
  const branchUrl = getBranchUrl(githubBaseUrl, branch);

  const handleToggleExpand = async () => {
    const willExpand = !expanded;
    setExpanded(willExpand);

    if (willExpand && recentActivities === null) {
      setLoadingActivities(true);
      try {
        const res = await fetchWithTimeout(`/api/v1/sessions/${session.id}/activities?limit=5`);
        if (res.ok) {
          const json = (await res.json()) as { data: { activities: CompactActivity[] } };
          setRecentActivities(json.data.activities);
        }
      } catch {
        setRecentActivities([]);
      } finally {
        setLoadingActivities(false);
      }
    }
  };

  return (
    <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
      {/* Header — clickable to expand */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={handleToggleExpand}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggleExpand(); } }}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-md)',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <span
            style={{
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              display: 'inline-block',
              color: 'var(--text-muted)',
              fontSize: '0.625rem',
            }}
          >
            ▶
          </span>
          <span style={{ fontWeight: 600 }}>{user?.name ?? 'Unknown'}</span>
          <span className="text-muted">·</span>
          <span className="text-secondary">{device?.name ?? 'local'}</span>
          {device?.is_remote && (
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>(remote)</span>
          )}
          <span className="text-muted">·</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className={`status-dot ${status}`} aria-label={`Status: ${status}`} />
            <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
              {getStatusLabel(status)}
            </span>
          </span>
          <span className="text-muted" style={{ fontSize: '0.875rem' }}>
            {relativeTime}
          </span>
          {/* v2 badges: agent, model, cost, turns */}
          {agentLabel && (
            <>
              <span className="text-muted">·</span>
              <span
                style={{
                  fontSize: '0.6875rem',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--accent-orange)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {agentLabel}
              </span>
            </>
          )}
          {modelLabel && (
            <>
              <span className="text-muted">·</span>
              <span
                style={{
                  fontSize: '0.6875rem',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--accent-blue)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {modelLabel}
              </span>
            </>
          )}
          {num_turns !== undefined && num_turns > 0 && (
            <>
              <span className="text-muted">·</span>
              <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
                {num_turns} turn{num_turns !== 1 ? 's' : ''}
              </span>
            </>
          )}
          {costLabel && (
            <>
              <span className="text-muted">·</span>
              <span
                style={{
                  fontSize: '0.6875rem',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--accent-green)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {costLabel}
              </span>
            </>
          )}
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
                const url = getFileUrl(file, githubBaseUrl, branch, worktree);
                const fileName = file.split('/').pop();
                const key = `${i}:${file}`;
                return url ? (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="file-tag file-tag-link"
                    title={getRelativeFilePath(file, worktree)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {fileName}
                  </a>
                ) : (
                  <span key={key} className="file-tag" title={file}>
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
              <a href={branchUrl} target="_blank" rel="noopener noreferrer" className="footer-link" onClick={(e) => e.stopPropagation()}>
                {branch}
              </a>
            ) : (
              <span>{branch}</span>
            )
          )}
          {branch && repo && <span> · </span>}
          {repo && (
            <a href={`/repo/${repo.id}`} className="footer-link" onClick={(e) => e.stopPropagation()}>
              {repo.name}
            </a>
          )}
        </div>
      )}

      {/* Expandable inline activity preview */}
      {expanded && (
        <div style={{
          marginTop: 'var(--space-md)',
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: 'var(--space-md)',
        }}>
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.05em',
            marginBottom: 'var(--space-sm)',
          }}>
            Recent Activity
          </div>

          {loadingActivities ? (
            <div className="text-muted" style={{ fontSize: '0.875rem', padding: 'var(--space-xs) 0' }}>
              Loading...
            </div>
          ) : recentActivities && recentActivities.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              {recentActivities.map((act) => (
                <div
                  key={act.id}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 'var(--space-sm)',
                    padding: 'var(--space-xs) 0',
                    fontSize: '0.875rem',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <span className="text-muted" style={{ fontSize: '0.75rem', flexShrink: 0 }}>
                    {formatRelativeTime(act.created_at)}
                  </span>
                  {act.semantic_scope && (
                    <span className="scope-badge" style={{ fontSize: '0.6875rem' }}>{act.semantic_scope}</span>
                  )}
                  {act.summary && (
                    <span className="text-secondary" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {act.summary}
                    </span>
                  )}
                  {act.files.length > 0 && (
                    <span className="text-muted" style={{ fontSize: '0.75rem', flexShrink: 0 }}>
                      {act.files.length} file{act.files.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : recentActivities && recentActivities.length === 0 ? (
            <div className="text-muted" style={{ fontSize: '0.875rem' }}>
              No activity recorded yet
            </div>
          ) : null}

          <a
            href={`/session/${session.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'inline-block',
              marginTop: 'var(--space-sm)',
              fontSize: '0.875rem',
              color: 'var(--accent-blue)',
              textDecoration: 'none',
            }}
          >
            View full session →
          </a>
        </div>
      )}
    </div>
  );
});
