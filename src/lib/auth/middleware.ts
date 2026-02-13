import type { D1Database } from '@cloudflare/workers-types';
import { getMemberByTokenHash, getTeamConfig, getWebSessionByTokenHash } from '@lib/db/queries';
import type { Member, TeamConfig } from '@lib/db/types';

export type AuthContext = {
  member: Member;
  teamConfig: TeamConfig;
};

export type AuthResult =
  | { success: true; context: AuthContext }
  | { success: false; error: string; status: number };

/**
 * Hash a token using SHA-256 for storage/comparison.
 * Used for both user tokens and web session tokens.
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
}

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
  const tokenHash = await hashToken(sessionToken);

  // Find session
  const webSession = await getWebSessionByTokenHash(db, tokenHash);
  if (!webSession) {
    return { success: false, error: 'Session expired', status: 401 };
  }

  // Get team config
  const teamConfig = await getTeamConfig(db);
  if (!teamConfig) {
    return { success: false, error: 'Team not configured', status: 500 };
  }

  // For web sessions, we create a virtual "admin" member since dashboard access
  // is password-based, not token-based. The dashboard user has admin access.
  const virtualMember: Member = {
    user_id: 'dashboard',
    display_name: 'Dashboard User',
    email: null,
    token_hash: '',
    role: 'admin',
    last_active_at: null,
    created_at: webSession.created_at,
    updated_at: webSession.created_at,
  };

  return { success: true, context: { member: virtualMember, teamConfig } };
}

/**
 * Authenticate a request using Bearer token (user_token).
 * Used by the tracer binary to authenticate API calls.
 *
 * The token is hashed and compared against the stored token_hash in members table.
 */
export async function authenticateTracer(
  request: Request,
  db: D1Database
): Promise<AuthResult> {
  // Get user token from Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { success: false, error: 'Missing Authorization header', status: 401 };
  }

  const userToken = authHeader.slice(7); // Remove 'Bearer ' prefix

  // Hash the token to compare with stored hash
  const tokenHash = await hashToken(userToken);

  // Find member by token hash
  const member = await getMemberByTokenHash(db, tokenHash);
  if (!member) {
    return { success: false, error: 'Invalid user token', status: 401 };
  }

  // Get team config
  const teamConfig = await getTeamConfig(db);
  if (!teamConfig) {
    return { success: false, error: 'Team not configured', status: 500 };
  }

  return { success: true, context: { member, teamConfig } };
}

/**
 * Authenticate using either web session or tracer token.
 * Tries web session first (for dashboard), then tracer token (for binary).
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

  // Try tracer token auth
  const tracerResult = await authenticateTracer(request, db);
  return tracerResult;
}

/**
 * Require admin role for a request.
 */
export function requireAdmin(context: AuthContext): AuthResult {
  if (context.member.role !== 'admin') {
    return { success: false, error: 'Admin access required', status: 403 };
  }
  return { success: true, context };
}

/**
 * Check if member is an admin.
 */
export function isAdmin(context: AuthContext): boolean {
  return context.member.role === 'admin';
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

/**
 * Generate a secure random token.
 * Format: tok_<32 random hex characters>
 */
export function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `tok_${hex}`;
}

/**
 * Generate a nanoid-style ID for database records.
 */
export function generateId(): string {
  return crypto.randomUUID();
}
