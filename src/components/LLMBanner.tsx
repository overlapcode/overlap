import { useState, useEffect } from 'react';
import { fetchWithTimeout } from '@lib/utils/fetch';

type LLMSettings = {
  provider: string | null;
  model: string | null;
  has_api_key: boolean;
  is_admin: boolean;
};

export function LLMBanner() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    async function checkLLM() {
      try {
        const res = await fetchWithTimeout('/api/v1/admin/llm');
        if (!res.ok) return;
        const data = (await res.json()) as { data: LLMSettings };
        const provider = data.data.provider;
        if (!provider || provider === 'heuristic') {
          setShow(true);
        }
      } catch {
        // Silently ignore — banner is optional
      }
    }
    checkLLM();
  }, []);

  if (!show || dismissed) return null;

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
            backgroundColor: 'var(--accent-blue)',
            color: 'var(--text-primary)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
        >
          TIP
        </span>
        <span className="text-secondary" style={{ fontSize: '0.875rem' }}>
          Set up an LLM provider for better activity summaries.
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <a
          href="/settings/llm"
          className="btn btn-primary"
          style={{ fontSize: '0.75rem', padding: '4px 12px', textDecoration: 'none' }}
        >
          Configure LLM
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
