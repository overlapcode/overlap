type ViewMode = 'timeline' | 'byUser';

type ViewToggleProps = {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
};

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="View mode"
      style={{
        display: 'inline-flex',
        backgroundColor: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-sm)',
        padding: '2px',
      }}
    >
      <button
        role="tab"
        aria-selected={value === 'timeline'}
        onClick={() => onChange('timeline')}
        style={{
          padding: 'var(--space-xs) var(--space-sm)',
          backgroundColor: value === 'timeline' ? 'var(--bg-surface)' : 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-xs)',
          color: value === 'timeline' ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: value === 'timeline' ? 500 : 400,
          transition: 'all 0.15s ease',
        }}
      >
        Timeline
      </button>
      <button
        role="tab"
        aria-selected={value === 'byUser'}
        onClick={() => onChange('byUser')}
        style={{
          padding: 'var(--space-xs) var(--space-sm)',
          backgroundColor: value === 'byUser' ? 'var(--bg-surface)' : 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-xs)',
          color: value === 'byUser' ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: value === 'byUser' ? 500 : 400,
          transition: 'all 0.15s ease',
        }}
      >
        By Person
      </button>
    </div>
  );
}
