import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateAny, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getTeamConfig, updateTeamConfig } from '@lib/db/queries';

const UpdateTeamSchema = z.object({
  team_name: z.string().min(1).max(100).optional(),
  stale_timeout_hours: z.number().min(1).max(168).optional(),
});

// GET: Retrieve team settings
export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate and require admin (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  try {
    const config = await getTeamConfig(db);
    if (!config) {
      return errorResponse('Team not configured', 404);
    }

    return successResponse({
      team_name: config.team_name,
      team_join_code: config.team_join_code,
      stale_timeout_hours: config.stale_timeout_hours,
      llm_provider: config.llm_provider,
      llm_model: config.llm_model,
      has_llm_api_key: !!config.llm_api_key_encrypted,
    });
  } catch (error) {
    console.error('Get team error:', error);
    return errorResponse('Failed to get team settings', 500);
  }
}

// PUT: Update team settings
export async function PUT(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate and require admin (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parseResult = UpdateTeamSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const input = parseResult.data;

  try {
    const updates: Partial<{
      team_name: string;
      stale_timeout_hours: number;
    }> = {};

    if (input.team_name !== undefined) {
      updates.team_name = input.team_name;
    }
    if (input.stale_timeout_hours !== undefined) {
      updates.stale_timeout_hours = input.stale_timeout_hours;
    }

    if (Object.keys(updates).length === 0) {
      return successResponse({ message: 'No changes made' });
    }

    await updateTeamConfig(db, updates);

    return successResponse({ message: 'Team settings updated successfully' });
  } catch (error) {
    console.error('Update team error:', error);
    return errorResponse('Failed to update team settings', 500);
  }
}
