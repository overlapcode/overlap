/**
 * Server-side session utilities for Astro pages.
 * Used to get the current user from the session cookie.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { getUserById, getTeam } from '@lib/db/queries';

export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
  role: 'admin' | 'member';
};

export type SessionData = {
  user: SessionUser;
  team: {
    id: string;
    name: string;
  };
} | null;

/**
 * Get the current user from the session cookie.
 * Returns null if not authenticated.
 */
export async function getSessionUser(
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
    const session = await db
      .prepare(
        `SELECT ws.user_id
         FROM web_sessions ws
         WHERE ws.token_hash = ?
         AND ws.expires_at > datetime('now')`
      )
      .bind(tokenHash)
      .first<{ user_id: string }>();

    if (!session) {
      return null;
    }

    // Get user
    const user = await getUserById(db, session.user_id);
    if (!user || !user.is_active) {
      return null;
    }

    // Get team
    const team = await getTeam(db);
    if (!team) {
      return null;
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      team: {
        id: team.id,
        name: team.name,
      },
    };
  } catch (error) {
    console.error('Session lookup error:', error);
    return null;
  }
}
