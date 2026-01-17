import type { APIContext } from 'astro';
import { z } from 'zod';
import { errorResponse, successResponse } from '@lib/auth/middleware';
import { getTeam, createUser } from '@lib/db/queries';
import { generateId, generateToken } from '@lib/utils/id';

const JoinSchema = z.object({
  team_token: z.string().min(1),
  name: z.string().min(1).max(100),
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
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const input = parseResult.data;

  try {
    // Validate team token
    const team = await getTeam(db);
    if (!team) {
      return errorResponse('Team not found', 404);
    }

    if (team.team_token !== input.team_token) {
      return errorResponse('Invalid team token', 401);
    }

    // Generate user token
    const userId = generateId();
    const userToken = generateToken();

    // Create user
    await createUser(db, {
      id: userId,
      team_id: team.id,
      user_token: userToken,
      name: input.name,
      email: input.email ?? null,
      role: 'member',
    });

    return successResponse({
      user_id: userId,
      user_token: userToken,
      team_name: team.name,
      message: 'Joined team successfully',
    }, 201);
  } catch (error) {
    console.error('Join error:', error);
    return errorResponse('Failed to join team', 500);
  }
}
