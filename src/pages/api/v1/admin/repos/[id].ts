import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateAny, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getRepoById, updateRepo, deleteRepo } from '@lib/db/queries';

const UpdateRepoSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  display_name: z.string().max(200).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});

export async function PUT(context: APIContext) {
  const { request, params } = context;
  const repoId = params.id as string;
  const db = context.locals.runtime.env.DB;

  // Authenticate and require admin
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

  const parseResult = UpdateRepoSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const input = parseResult.data;

  try {
    // Check repo exists
    const repo = await getRepoById(db, repoId);
    if (!repo) {
      return errorResponse('Repository not found', 404);
    }

    if (Object.keys(input).length === 0) {
      return successResponse({ message: 'No changes made' });
    }

    await updateRepo(db, repoId, {
      name: input.name,
      display_name: input.display_name,
      description: input.description,
    });

    return successResponse({ message: 'Repository updated successfully' });
  } catch (error) {
    console.error('Update repo error:', error);
    return errorResponse('Failed to update repository', 500);
  }
}

export async function DELETE(context: APIContext) {
  const { request, params } = context;
  const repoId = params.id as string;
  const db = context.locals.runtime.env.DB;

  // Authenticate and require admin
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  try {
    // Check repo exists
    const repo = await getRepoById(db, repoId);
    if (!repo) {
      return errorResponse('Repository not found', 404);
    }

    await deleteRepo(db, repoId);

    return successResponse({ message: 'Repository deleted successfully' });
  } catch (error) {
    console.error('Delete repo error:', error);
    return errorResponse('Failed to delete repository', 500);
  }
}
