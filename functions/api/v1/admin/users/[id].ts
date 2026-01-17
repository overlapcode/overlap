import { z } from 'zod';
import { authenticateRequest, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getUserById } from '@lib/db/queries';

const UpdateUserSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  is_active: z.boolean().optional(),
  stale_timeout_hours: z.number().min(1).max(168).nullable().optional(),
});

type Env = {
  DB: D1Database;
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const userId = params.id as string;

  // Authenticate and require admin
  const authResult = await authenticateRequest(request, env.DB);
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

  const parseResult = UpdateUserSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const input = parseResult.data;

  try {
    // Get user to update
    const user = await getUserById(env.DB, userId);
    if (!user) {
      return errorResponse('User not found', 404);
    }

    // Build update query
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.role !== undefined) {
      updates.push('role = ?');
      values.push(input.role);
    }
    if (input.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(input.is_active ? 1 : 0);
    }
    if (input.stale_timeout_hours !== undefined) {
      updates.push('stale_timeout_hours = ?');
      values.push(input.stale_timeout_hours);
    }

    if (updates.length === 0) {
      return successResponse({ message: 'No changes made' });
    }

    updates.push("updated_at = datetime('now')");
    values.push(userId);

    await env.DB
      .prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return successResponse({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    return errorResponse('Failed to update user', 500);
  }
};
