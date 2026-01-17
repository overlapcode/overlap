import { useState, useEffect, useCallback } from 'react';
import { ActivityCard } from './ActivityCard';

type Session = {
  id: string;
  user: { id: string; name: string };
  device: { id: string; name: string; is_remote: boolean };
  repo: { id: string; name: string } | null;
  branch: string | null;
  status: 'active' | 'stale' | 'ended';
  started_at: string;
  last_activity_at: string;
  activity: {
    semantic_scope: string | null;
    summary: string | null;
    files: string[];
  } | null;
};

type TimelineProps = {
  userToken: string;
  teamToken: string;
  apiBaseUrl?: string;
};

export function Timeline({ userToken, teamToken, apiBaseUrl = '' }: TimelineProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const fetchInitialData = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/activity`, {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'X-Team-Token': teamToken,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch activity');
      }

      const data = await response.json() as { data: { sessions: Session[] } };
      setSessions(data.data.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    }
  }, [userToken, teamToken, apiBaseUrl]);

  useEffect(() => {
    // Fetch initial data
    fetchInitialData();

    // Set up SSE connection
    const eventSource = new EventSource(
      `${apiBaseUrl}/api/v1/stream`,
      // Note: EventSource doesn't support custom headers in the browser
      // We'll need to use query params or cookies for auth in production
    );

    eventSource.addEventListener('connected', () => {
      setIsConnected(true);
      setError(null);
    });

    eventSource.addEventListener('activity', (event) => {
      try {
        const newSession = JSON.parse(event.data) as Session;
        setSessions((prev) => {
          // Update existing session or add new one
          const existing = prev.findIndex((s) => s.id === newSession.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = newSession;
            // Re-sort by last activity
            updated.sort(
              (a, b) =>
                new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime()
            );
            return updated;
          }
          return [newSession, ...prev];
        });
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    });

    eventSource.addEventListener('error', () => {
      setIsConnected(false);
      setError('Connection lost. Reconnecting...');
    });

    return () => {
      eventSource.close();
    };
  }, [fetchInitialData, apiBaseUrl]);

  return (
    <div>
      {/* Connection status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          marginBottom: 'var(--space-lg)',
          padding: 'var(--space-sm) var(--space-md)',
          backgroundColor: 'var(--bg-surface)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.875rem',
        }}
      >
        <span
          className={`status-dot ${isConnected ? 'active' : 'stale'}`}
          style={{ width: 6, height: 6 }}
        />
        <span className="text-secondary">
          {isConnected ? 'Connected' : 'Connecting...'}
        </span>
        {error && (
          <>
            <span className="text-muted">·</span>
            <span style={{ color: 'var(--accent-orange)' }}>{error}</span>
          </>
        )}
      </div>

      {/* Sessions list */}
      {sessions.length === 0 ? (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: 'var(--space-xl)',
          }}
        >
          <p className="text-secondary">No active sessions</p>
          <p className="text-muted" style={{ fontSize: '0.875rem', marginTop: 'var(--space-sm)' }}>
            Activity will appear here when team members start coding
          </p>
        </div>
      ) : (
        sessions.map((session) => <ActivityCard key={session.id} session={session} />)
      )}
    </div>
  );
}
