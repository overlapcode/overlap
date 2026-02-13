/**
 * PUT /api/repos/:id - Update a repo
 * DELETE /api/repos/:id - Delete a repo
 *
 * Auth: Web session (admin only)
 */

import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateWebSession, errorResponse, successResponse } from '@lib/auth/middleware';
import { getRepoById, updateRepo, deleteRepo } from '@lib/db/queries';

// PUT /api/repos/:id
const UpdateRepoSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  display_name: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
});

export async function PUT(context: APIContext) {
  const db = context.locals.runtime.env.DB;
  const { id } = context.params;

  if (!id) {
    return errorResponse('Repo ID required', 400);
  }

  // Require web session auth (admin action)
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Check repo exists
  const existing = await getRepoById(db, id);
  if (!existing) {
    return errorResponse('Repo not found', 404);
  }

  // Parse request body
  let body: z.infer<typeof UpdateRepoSchema>;
  try {
    const json = await context.request.json();
    body = UpdateRepoSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
    }
    return errorResponse('Invalid JSON payload', 400);
  }

  await updateRepo(db, id, body);

  const updated = await getRepoById(db, id);
  return successResponse(updated);
}

export async function DELETE(context: APIContext) {
  const db = context.locals.runtime.env.DB;
  const { id } = context.params;

  if (!id) {
    return errorResponse('Repo ID required', 400);
  }

  // Require web session auth (admin action)
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Check repo exists
  const existing = await getRepoById(db, id);
  if (!existing) {
    return errorResponse('Repo not found', 404);
  }

  await deleteRepo(db, id);

  return successResponse({ deleted: true });
}
