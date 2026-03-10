type GGHeaderProps = {
  teamName?: string;
  userName?: string;
  activePage?: string;
};

export function GGHeader({ teamName, userName, activePage }: GGHeaderProps) {
  const navLinks = [
    { href: '/stats', label: 'Stats' },
    { href: '/insights', label: 'Insights' },
    { href: '/overlaps', label: 'Overlaps' },
    { href: '/repos', label: 'Repos' },
    { href: '/history', label: 'History' },
    { href: '/settings', label: 'Config' },
  ];

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 20px',
        backgroundColor: 'rgba(12, 9, 7, 0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-default)',
      }}
    >
      {/* Left: Logo + Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <a
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <img
            src="/logo.png"
            alt="Overlap"
            width={20}
            height={20}
            style={{ borderRadius: '3px', opacity: 0.9 }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              fontSize: '0.8rem',
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              color: 'var(--text-primary)',
            }}
          >
            OVERLAP
          </span>
        </a>

        {teamName && (
          <>
            <span style={{
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
            }}>/</span>
            <a
              href="/"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
                textTransform: 'uppercase',
                letterSpacing: '0.15em',
                color: 'var(--text-secondary)',
                textDecoration: 'none',
              }}
            >
              {teamName}
            </a>
          </>
        )}

        {/* Status indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <span className="gg-status-dot" style={{ width: 6, height: 6 }} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.55rem',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            color: 'var(--text-muted)',
          }}>
            SYS.ONLINE
          </span>
        </div>
      </div>

      {/* Right: Nav + User */}
      {userName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {navLinks.map(link => (
            <a
              key={link.href}
              href={link.href}
              className={`gg-nav-link${activePage === link.label.toLowerCase() ? ' active' : ''}`}
            >
              {link.label}
            </a>
          ))}

          <span style={{
            marginLeft: '12px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--text-muted)',
            padding: '4px 8px',
            border: '1px solid var(--border-subtle)',
            borderRadius: '3px',
          }}>
            {userName}
          </span>
        </div>
      )}
    </header>
  );
}
