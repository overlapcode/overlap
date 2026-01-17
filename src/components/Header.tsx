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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '2px',
              width: '24px',
              height: '24px',
            }}
          >
            <div
              style={{
                backgroundColor: 'var(--accent-orange)',
                borderRadius: '2px 0 0 0',
              }}
            />
            <div
              style={{
                backgroundColor: 'var(--text-muted)',
                borderRadius: '0 2px 0 0',
              }}
            />
            <div
              style={{
                backgroundColor: 'var(--text-muted)',
                borderRadius: '0 0 0 2px',
              }}
            />
            <div
              style={{
                backgroundColor: 'var(--accent-orange)',
                borderRadius: '0 0 2px 0',
              }}
            />
          </div>
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
