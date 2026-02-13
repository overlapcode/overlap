import { useState, useEffect } from 'react';
import { fetchWithTimeout } from '@lib/utils/fetch';

type Repo = {
  id: string;
  name: string;
  remote_url: string | null;
  is_public: boolean;
};

function formatRemoteUrl(url: string | null): string {
  if (!url) return 'Local repository';
  if (url.includes('github.com')) {
    const match = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) return match[1];
  }
  return url.replace(/\.git$/, '').replace(/^https?:\/\//, '');
}

export function RepoList() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetchWithTimeout('/api/v1/admin/repos');
        const result = (await response.json()) as {
          data?: { repos: Repo[] };
          error?: string;
        };

        if (!response.ok) {
          throw new Error(result.error || 'Failed to load repositories');
        }

        setRepos(result.data?.repos || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load repositories');
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, []);

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
        <img src="/loading.gif" alt="Loading" width={48} height={48} style={{ opacity: 0.8 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--accent-orange)' }}>
        {error}
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
        <p className="text-secondary">No repositories tracked yet</p>
        <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: 'var(--space-sm)' }}>
          Repositories appear here automatically when you start
          working with the Overlap tracer running.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-sm)' }}>
        {repos.length} repositor{repos.length !== 1 ? 'ies' : 'y'}
      </div>
      {repos.map((repo) => (
        <a
          key={repo.id}
          href={`/repo/${repo.id}`}
          style={{
            display: 'block',
            textDecoration: 'none',
            color: 'inherit',
            marginBottom: 'var(--space-xs)',
          }}
        >
          <div
            className="card"
            style={{
              padding: 'var(--space-md)',
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-active)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = '';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontWeight: 500,
                  fontSize: '0.95rem',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                  marginBottom: 2,
                }}>
                  {repo.name}
                </div>
                <div className="text-muted" style={{
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {formatRemoteUrl(repo.remote_url)}
                </div>
              </div>
              <span className="text-muted" style={{ fontSize: '0.75rem', flexShrink: 0 }}>
                View activity →
              </span>
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
