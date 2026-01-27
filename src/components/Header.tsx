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
            <span className="text-secondary">{teamName}</span>
          </>
        )}
      </div>

      {/* User info */}
      {userName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <span className="text-secondary" style={{ fontSize: '0.875rem' }}>
            {userName}
          </span>
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
            My History
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
