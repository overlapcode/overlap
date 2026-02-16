import type { APIContext } from 'astro';
import { z } from 'zod';
import { errorResponse, successResponse, generateToken, hashToken } from '@lib/auth/middleware';
import { getTeamConfig, createTeamConfig, createMember, createWebSession } from '@lib/db/queries';
import { ensureMigrated } from '@lib/db/migrate';

const SetupSchema = z.object({
  team_name: z.string().min(1).max(100),
  admin_name: z.string().min(1).max(100),
  admin_email: z.string().email().nullable().optional(),
});

// GET: Check setup status and ensure database is migrated
export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Auto-migrate database
  await ensureMigrated(db);

  // Check if team already exists
  const existingConfig = await getTeamConfig(db);

  return successResponse({
    initialized: !!existingConfig,
    team_name: existingConfig?.team_name ?? null,
  });
}

// POST: Create team
export async function POST(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Auto-migrate database on first setup
  await ensureMigrated(db);

  // Check if team already exists
  const existingConfig = await getTeamConfig(db);
  if (existingConfig) {
    return errorResponse('Team already configured', 400);
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parseResult = SetupSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const input = parseResult.data;

  try {
    // Generate tokens
    const teamJoinCode = generateToken().replace('tok_', 'join_');
    const userToken = generateToken();
    const userTokenHash = await hashToken(userToken);
    const userId = crypto.randomUUID();

    // Create team config (no password)
    await createTeamConfig(db, {
      team_name: input.team_name,
      password_hash: '',
      team_join_code: teamJoinCode,
    });

    // Create admin member
    await createMember(db, {
      user_id: userId,
      display_name: input.admin_name,
      email: input.admin_email ?? undefined,
      token_hash: userTokenHash,
      role: 'admin',
    });

    // Auto-create web session so admin is logged in immediately
    const sessionId = crypto.randomUUID();
    const webSessionToken = crypto.randomUUID();
    const sessionTokenHash = await hashToken(webSessionToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await createWebSession(db, sessionId, sessionTokenHash, expiresAt.toISOString(), userId);

    // Set session cookie server-side (HttpOnly — can't be overridden client-side)
    const response = successResponse({
      team_join_code: teamJoinCode,
      user_id: userId,
      user_token: userToken,
      message: 'Team created successfully',
    }, 201);
    const headers = new Headers(response.headers);
    headers.set(
      'Set-Cookie',
      `overlap_session=${webSessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expiresAt.toUTCString()}`
    );
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error('Setup error:', error);
    return errorResponse('Failed to create team', 500);
  }
}
