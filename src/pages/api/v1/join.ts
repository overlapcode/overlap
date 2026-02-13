/**
 * POST /api/v1/join - Self-serve member registration
 *
 * Allows new members to join by providing the team join code.
 */

import type { APIContext } from 'astro';
import { z } from 'zod';
import { errorResponse, successResponse, generateToken, generateId, hashToken } from '@lib/auth/middleware';
import { getTeamConfig, createMember, getAllMembers } from '@lib/db/queries';

const JoinSchema = z.object({
  team_join_code: z.string().min(1, 'Team join code is required'),
  display_name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email().nullable().optional(),
});

export async function POST(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parseResult = JoinSchema.safeParse(body);
  if (!parseResult.success) {
    const firstError = parseResult.error.errors[0];
    return errorResponse(firstError?.message || 'Validation error', 400);
  }

  const input = parseResult.data;

  try {
    // Get team config
    const teamConfig = await getTeamConfig(db);
    if (!teamConfig) {
      return errorResponse('Team not configured. Please run /setup first.', 404);
    }

    // Validate join code
    if (teamConfig.team_join_code !== input.team_join_code) {
      return errorResponse('Invalid team join code', 401);
    }

    // Check for existing member with same name (idempotency)
    const existingMembers = await getAllMembers(db);
    const existingMember = existingMembers.find(
      (m) => m.display_name.toLowerCase() === input.display_name.toLowerCase()
    );

    if (existingMember) {
      return errorResponse(
        'A member with this name already exists. Please use a different name or contact your admin.',
        409
      );
    }

    // Generate user ID and token
    const userId = generateId();
    const userToken = generateToken();
    const tokenHash = await hashToken(userToken);

    // Create member
    await createMember(db, {
      user_id: userId,
      display_name: input.display_name,
      email: input.email ?? undefined,
      token_hash: tokenHash,
      role: 'member',
    });

    return successResponse(
      {
        user_id: userId,
        user_token: userToken, // Only time we return the raw token
        team_name: teamConfig.team_name,
        message: 'Welcome to the team!',
      },
      201
    );
  } catch (error) {
    console.error('Join error:', error);
    return errorResponse('Failed to join team', 500);
  }
}
