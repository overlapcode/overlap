type HeaderProps = {
  teamName?: string;
  userName?: string;
};

export function Header({ teamName, userName }: HeaderProps) {
  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 'var(--space-md) var(--space-lg)',
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
        <a
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-md)',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <img
            src="/logo.png"
            alt="Overlap"
            width={24}
            height={24}
            style={{ borderRadius: '4px' }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            overlap
          </span>
        </a>
        {teamName && (
          <>
            <span className="text-muted">/</span>
            <a href="/" className="text-secondary" style={{ textDecoration: 'none' }}>{teamName}</a>
          </>
        )}
      </div>

      {/* User info */}
      {userName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <a href="/" className="text-secondary" style={{ fontSize: '0.875rem', textDecoration: 'none' }}>
            {userName}
          </a>
          <a
            href="/stats"
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
          >
            Stats
          </a>
          <a
            href="/insights"
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
          >
            Insights
          </a>
          <a
            href="/overlaps"
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
          >
            Overlaps
          </a>
          <a
            href="/repos"
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
          >
            Repos
          </a>
          <a
            href="/history"
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
          >
            History
          </a>
          <a
            href="/settings"
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
          >
            Settings
          </a>
        </div>
      )}
    </header>
  );
}
