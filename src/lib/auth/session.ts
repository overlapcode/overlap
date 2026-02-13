/**
 * Server-side session utilities for Astro pages.
 * Used to check if the user has dashboard access via password authentication.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { getTeamConfig, getWebSessionByTokenHash } from '@lib/db/queries';

export type SessionData = {
  teamName: string;
  isAuthenticated: boolean;
} | null;

/**
 * Get session data from the session cookie.
 * In v2, dashboard access is password-based, not user-based.
 * Returns null if not authenticated.
 */
export async function getSessionData(
  cookies: { get: (name: string) => { value: string } | undefined },
  db: D1Database
): Promise<SessionData> {
  try {
    const sessionCookie = cookies.get('overlap_session');
    if (!sessionCookie?.value) {
      return null;
    }

    const sessionToken = sessionCookie.value;

    // Hash the token to compare with stored hash
    const encoder = new TextEncoder();
    const data = encoder.encode(sessionToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const tokenHash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

    // Find session
    const session = await getWebSessionByTokenHash(db, tokenHash);
    if (!session) {
      return null;
    }

    // Get team config
    const config = await getTeamConfig(db);
    if (!config) {
      return null;
    }

    return {
      teamName: config.team_name,
      isAuthenticated: true,
    };
  } catch (error) {
    console.error('Session lookup error:', error);
    return null;
  }
}
