import type { APIContext } from 'astro';
import { z } from 'zod';
import { errorResponse, successResponse, generateToken, hashToken } from '@lib/auth/middleware';
import { getTeamConfig, createTeamConfig, createMember } from '@lib/db/queries';
import { hashPassword } from '@lib/utils/crypto';
import { ensureMigrated } from '@lib/db/migrate';

const SetupSchema = z.object({
  team_name: z.string().min(1).max(100),
  admin_name: z.string().min(1).max(100),
  admin_email: z.string().email().nullable().optional(),
  dashboard_password: z.string().min(8),
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

    // Hash password
    const passwordHash = await hashPassword(input.dashboard_password);

    // Create team config
    await createTeamConfig(db, {
      team_name: input.team_name,
      password_hash: passwordHash,
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

    return successResponse({
      team_join_code: teamJoinCode,
      user_id: userId,
      user_token: userToken,
      message: 'Team created successfully',
    }, 201);
  } catch (error) {
    console.error('Setup error:', error);
    return errorResponse('Failed to create team', 500);
  }
}
