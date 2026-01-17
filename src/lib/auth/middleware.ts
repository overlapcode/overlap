import type { D1Database } from '@cloudflare/workers-types';
import { getUserByToken, getTeam, getUserById } from '@lib/db/queries';
import type { User, Team } from '@lib/db/types';

export type AuthContext = {
  user: User;
  team: Team;
};

export type AuthResult =
  | { success: true; context: AuthContext }
  | { success: false; error: string; status: number };

/**
 * Authenticate a request using web session cookie.
 * Used by the web dashboard for browser-based access.
 */
export async function authenticateWebSession(
  request: Request,
  db: D1Database
): Promise<AuthResult> {
  // Get session token from cookie
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) {
    return { success: false, error: 'Not authenticated', status: 401 };
  }

  // Parse cookies
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [key, ...val] = c.trim().split('=');
      return [key, val.join('=')];
    })
  );

  const sessionToken = cookies['overlap_session'];
  if (!sessionToken) {
    return { success: false, error: 'Not authenticated', status: 401 };
  }

  // Hash the token to compare with stored hash
  const encoder = new TextEncoder();
  const data = encoder.encode(sessionToken);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const tokenHash = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

  // Find session
  const session = await db
    .prepare(
      `SELECT ws.*, u.id as user_id
       FROM web_sessions ws
       JOIN users u ON ws.user_id = u.id
       WHERE ws.token_hash = ?
       AND ws.expires_at > datetime('now')`
    )
    .bind(tokenHash)
    .first<{ user_id: string }>();

  if (!session) {
    return { success: false, error: 'Session expired', status: 401 };
  }

  // Get user and team
  const user = await getUserById(db, session.user_id);
  if (!user || !user.is_active) {
    return { success: false, error: 'User not found or inactive', status: 401 };
  }

  const team = await getTeam(db);
  if (!team) {
    return { success: false, error: 'Team not configured', status: 500 };
  }

  return { success: true, context: { user, team } };
}

/**
 * Authenticate a request using Bearer token (user_token) and X-Team-Token header.
 * Used by the Claude Code plugin to authenticate API calls.
 */
export async function authenticateRequest(
  request: Request,
  db: D1Database
): Promise<AuthResult> {
  // Get user token from Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { success: false, error: 'Missing Authorization header', status: 401 };
  }

  const userToken = authHeader.slice(7); // Remove 'Bearer ' prefix

  // Get team token from header
  const teamToken = request.headers.get('X-Team-Token');
  if (!teamToken) {
    return { success: false, error: 'Missing X-Team-Token header', status: 401 };
  }

  // Validate team
  const team = await getTeam(db);
  if (!team) {
    return { success: false, error: 'Team not configured', status: 500 };
  }

  if (team.team_token !== teamToken) {
    return { success: false, error: 'Invalid team token', status: 401 };
  }

  // Validate user
  const user = await getUserByToken(db, userToken);
  if (!user) {
    return { success: false, error: 'Invalid user token', status: 401 };
  }

  if (!user.is_active) {
    return { success: false, error: 'User is inactive', status: 403 };
  }

  if (user.team_id !== team.id) {
    return { success: false, error: 'User does not belong to this team', status: 403 };
  }

  return { success: true, context: { user, team } };
}

/**
 * Authenticate using either web session or API tokens.
 * Tries web session first (for dashboard), then API tokens (for plugin).
 */
export async function authenticateAny(
  request: Request,
  db: D1Database
): Promise<AuthResult> {
  // Try web session first
  const webResult = await authenticateWebSession(request, db);
  if (webResult.success) {
    return webResult;
  }

  // Try API token auth
  const apiResult = await authenticateRequest(request, db);
  return apiResult;
}

/**
 * Require admin role for a request.
 */
export function requireAdmin(context: AuthContext): AuthResult {
  if (context.user.role !== 'admin') {
    return { success: false, error: 'Admin access required', status: 403 };
  }
  return { success: true, context };
}

/**
 * Create a JSON error response.
 */
export function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

/**
 * Create a JSON success response.
 */
export function successResponse<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}
