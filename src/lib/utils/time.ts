// Time utilities

import { useState, useEffect } from 'react';

function normalizeUTC(dateString: string): string {
  if (!dateString) return new Date().toISOString();
  if (dateString.includes('Z') || dateString.includes('+') || dateString.includes('-', 10)) {
    return dateString;
  }
  return dateString.replace(' ', 'T') + 'Z';
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(normalizeUTC(dateString));
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 0) return 'just now';
  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function useRelativeTime(dateString: string): string {
  const [relativeTime, setRelativeTime] = useState(() => formatRelativeTime(dateString));

  useEffect(() => {
    setRelativeTime(formatRelativeTime(dateString));
    const interval = setInterval(() => {
      setRelativeTime(formatRelativeTime(dateString));
    }, 30000);
    return () => clearInterval(interval);
  }, [dateString]);

  return relativeTime;
}

export function isStale(lastActivityAt: string, staleHours: number): boolean {
  const lastActivity = new Date(normalizeUTC(lastActivityAt));
  const now = new Date();
  const diffMs = now.getTime() - lastActivity.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours > staleHours;
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
