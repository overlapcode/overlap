import { useState, useEffect, useRef, useCallback } from 'react';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

type SSEOptions = {
  url: string;
  onEvent: (event: MessageEvent) => void;
  eventName?: string;
  enabled?: boolean;
};

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;
const BACKOFF_MULTIPLIER = 2;
const MAX_RETRIES = 10;

export function useSSE({ url, onEvent, eventName = 'activity', enabled = true }: SSEOptions) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [lastEventTime, setLastEventTime] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(INITIAL_RETRY_MS);
  const retryCountRef = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    cleanup();
    if (!enabled) return;

    setConnectionState('connecting');
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener('connected', () => {
      setConnectionState('connected');
      setError(null);
      retryDelayRef.current = INITIAL_RETRY_MS;
      retryCountRef.current = 0;
    });

    es.addEventListener(eventName, (event) => {
      setLastEventTime(event.lastEventId || null);
      onEventRef.current(event);
    });

    es.addEventListener('error', () => {
      setConnectionState('disconnected');
      es.close();
      eventSourceRef.current = null;

      retryCountRef.current += 1;
      if (retryCountRef.current > MAX_RETRIES) {
        setError('Connection lost. Click to reconnect.');
        return;
      }

      const delay = retryDelayRef.current;
      setError(`Reconnecting in ${Math.round(delay / 1000)}s...`);
      retryTimeoutRef.current = setTimeout(() => {
        retryDelayRef.current = Math.min(
          retryDelayRef.current * BACKOFF_MULTIPLIER,
          MAX_RETRY_MS
        );
        connect();
      }, delay);
    });
  }, [url, eventName, enabled, cleanup]);

  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    retryDelayRef.current = INITIAL_RETRY_MS;
    setError(null);
    connect();
  }, [connect]);

  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  return { connectionState, lastEventTime, error, reconnect };
}
