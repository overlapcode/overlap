import { useState, useEffect } from 'react';
import { useBasePath } from '@lib/hooks/useBasePath';

type VersionInfo = {
  local: string | null;
  latest: string | null;
  loading: boolean;
  error: string | null;
};

const UPSTREAM_PACKAGE_URL = 'https://raw.githubusercontent.com/overlapcode/overlap/main/package.json';

type LocalVersionResponse = {
  data?: { version: string };
  version?: string;
};

type PackageJson = {
  version: string;
};

function compareVersions(local: string, latest: string): number {
  const localParts = local.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < Math.max(localParts.length, latestParts.length); i++) {
    const l = localParts[i] || 0;
    const r = latestParts[i] || 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

export function UpdateBanner() {
  const basePath = useBasePath();
  const [versionInfo, setVersionInfo] = useState<VersionInfo>({
    local: null,
    latest: null,
    loading: true,
    error: null,
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    async function checkVersions() {
      try {
        // Fetch local version
        const localRes = await fetch('/api/v1/version');
        if (!localRes.ok) throw new Error('Failed to fetch local version');
        const localData: LocalVersionResponse = await localRes.json();
        const localVersion = localData.data?.version || localData.version || null;

        // Fetch latest version from upstream
        const latestRes = await fetch(UPSTREAM_PACKAGE_URL);
        if (!latestRes.ok) throw new Error('Failed to fetch latest version');
        const latestData: PackageJson = await latestRes.json();
        const latestVersion = latestData.version;

        setVersionInfo({
          local: localVersion,
          latest: latestVersion,
          loading: false,
          error: null,
        });
      } catch (err) {
        setVersionInfo((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    }

    checkVersions();
  }, []);

  // Don't show if loading, error, dismissed, or up-to-date
  if (versionInfo.loading || versionInfo.error || dismissed) {
    return null;
  }

  if (!versionInfo.local || !versionInfo.latest) {
    return null;
  }

  const comparison = compareVersions(versionInfo.local, versionInfo.latest);
  if (comparison >= 0) {
    // Up to date or ahead
    return null;
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border-default)',
        padding: 'var(--space-sm) var(--space-lg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-md)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
        <span
          style={{
            backgroundColor: 'var(--accent-orange)',
            color: 'var(--text-primary)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
        >
          UPDATE
        </span>
        <span style={{ fontSize: '0.875rem' }}>
          <span className="text-secondary">You're running </span>
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              backgroundColor: 'var(--bg-surface)',
              padding: '2px 6px',
              borderRadius: '3px',
            }}
          >
            v{versionInfo.local}
          </code>
          <span className="text-secondary"> — </span>
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              backgroundColor: 'var(--bg-surface)',
              padding: '2px 6px',
              borderRadius: '3px',
              color: 'var(--accent-green)',
            }}
          >
            v{versionInfo.latest}
          </code>
          <span className="text-secondary"> is available</span>
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <a
          href={`${basePath}/update`}
          className="btn btn-primary"
          style={{ fontSize: '0.75rem', padding: '4px 12px' }}
        >
          How to Update
        </a>
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: '4px',
            fontSize: '1.25rem',
            lineHeight: 1,
          }}
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
