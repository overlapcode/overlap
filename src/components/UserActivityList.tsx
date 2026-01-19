import { useState, useEffect, useCallback } from 'react';
import { UserAccordion } from './UserAccordion';

type UserActivitySummary = {
  userId: string;
  userName: string;
  sessionCount: number;
  latestActivity: string;
};

type UserActivityListProps = {
  showStale: boolean;
};

export function UserActivityList({ showStale }: UserActivityListProps) {
  const [users, setUsers] = useState<UserActivitySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        view: 'byUser',
        includeStale: String(showStale),
      });

      const response = await fetch(`/api/v1/activity?${params}`);
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || 'Failed to fetch users');
      }

      const data = (await response.json()) as { data: { users: UserActivitySummary[] } };
      setUsers(data.data.users);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  }, [showStale]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  if (isLoading) {
    return (
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: 'var(--space-xl)',
        }}
      >
        <img src="/loading.gif" alt="Loading" width={48} height={48} style={{ opacity: 0.8 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: 'var(--space-xl)',
          color: 'var(--accent-orange)',
        }}
      >
        {error}
      </div>
    );
  }

  if (users.length === 0) {
    return (
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
    );
  }

  return (
    <div>
      {users.map((user) => (
        <UserAccordion key={user.userId} user={user} showStale={showStale} />
      ))}
    </div>
  );
}
