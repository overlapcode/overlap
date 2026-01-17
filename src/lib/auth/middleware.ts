import type { D1Database } from '@cloudflare/workers-types';
import { getUserByToken, getTeam } from '@lib/db/queries';
import type { User, Team } from '@lib/db/types';

export type AuthContext = {
  user: User;
  team: Team;
};

export type AuthResult =
  | { success: true; context: AuthContext }
  | { success: false; error: string; status: number };

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
