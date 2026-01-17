import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateRequest, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';

const UpdateRepoSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  is_public: z.boolean().optional(),
});

export async function PUT(context: APIContext) {
  const { request, params } = context;
  const repoId = params.id as string;
  const db = context.locals.runtime.env.DB;

  // Authenticate and require admin
  const authResult = await authenticateRequest(request, db);
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

  const parseResult = UpdateRepoSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const input = parseResult.data;

  try {
    // Check repo exists
    const repo = await db
      .prepare('SELECT id FROM repos WHERE id = ?')
      .bind(repoId)
      .first();

    if (!repo) {
      return errorResponse('Repository not found', 404);
    }

    // Build update query
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

    if (updates.length === 0) {
      return successResponse({ message: 'No changes made' });
    }

    values.push(repoId);

    await db
      .prepare(`UPDATE repos SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return successResponse({ message: 'Repository updated successfully' });
  } catch (error) {
    console.error('Update repo error:', error);
    return errorResponse('Failed to update repository', 500);
  }
}
