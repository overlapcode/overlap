/**
 * PATCH /api/members/:id - Update a member
 * DELETE /api/members/:id - Delete a member
 *
 * Auth: Web session (admin only)
 */

import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateWebSession, errorResponse, successResponse } from '@lib/auth/middleware';
import { getMemberById, updateMember, deleteMember } from '@lib/db/queries';

// PATCH /api/members/:id
const UpdateMemberSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'member']).optional(),
});

export async function PATCH(context: APIContext) {
  const db = context.locals.runtime.env.DB;
  const { id } = context.params;

  if (!id) {
    return errorResponse('Member ID required', 400);
  }

  // Require web session auth
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Check member exists
  const existing = await getMemberById(db, id);
  if (!existing) {
    return errorResponse('Member not found', 404);
  }

  // Parse request body
  let body: z.infer<typeof UpdateMemberSchema>;
  try {
    const json = await context.request.json();
    body = UpdateMemberSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
    }
    return errorResponse('Invalid JSON payload', 400);
  }

  await updateMember(db, id, body);

  const updated = await getMemberById(db, id);
  return successResponse({
    user_id: updated!.user_id,
    display_name: updated!.display_name,
    email: updated!.email,
    role: updated!.role,
    last_active_at: updated!.last_active_at,
    created_at: updated!.created_at,
  });
}

export async function DELETE(context: APIContext) {
  const db = context.locals.runtime.env.DB;
  const { id } = context.params;

  if (!id) {
    return errorResponse('Member ID required', 400);
  }

  // Require web session auth
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Check member exists
  const existing = await getMemberById(db, id);
  if (!existing) {
    return errorResponse('Member not found', 404);
  }

  await deleteMember(db, id);

  return successResponse({ deleted: true });
}
