import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateAny, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { hashPassword } from '@lib/utils/crypto';
import { getTeam } from '@lib/db/queries';

const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  is_public: z.boolean().optional(),
  stale_timeout_hours: z.number().min(1).max(168).optional(),
  dashboard_password: z.string().min(8).optional(),
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
    const team = await getTeam(db);
    if (!team) {
      return errorResponse('Team not found', 404);
    }

    return successResponse({
      name: team.name,
      team_token: team.team_token,
      is_public: team.is_public === 1,
      stale_timeout_hours: team.stale_timeout_hours,
      has_dashboard_password: !!team.dashboard_password_hash,
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

  const { team } = authResult.context;

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
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }
    if (input.is_public !== undefined) {
      updates.push('is_public = ?');
      values.push(input.is_public ? 1 : 0);
    }
    if (input.stale_timeout_hours !== undefined) {
      updates.push('stale_timeout_hours = ?');
      values.push(input.stale_timeout_hours);
    }
    if (input.dashboard_password !== undefined) {
      const passwordHash = await hashPassword(input.dashboard_password);
      updates.push('dashboard_password_hash = ?');
      values.push(passwordHash);
    }

    if (updates.length === 0) {
      return successResponse({ message: 'No changes made' });
    }

    updates.push("updated_at = datetime('now')");
    values.push(team.id);

    await db
      .prepare(`UPDATE teams SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return successResponse({ message: 'Team settings updated successfully' });
  } catch (error) {
    console.error('Update team error:', error);
    return errorResponse('Failed to update team settings', 500);
  }
}
