import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateAny, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getMemberById, updateMember, deleteMember } from '@lib/db/queries';

const UpdateUserSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  display_name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
});

export async function PUT(context: APIContext) {
  const { request, params } = context;
  const userId = params.id as string;
  const db = context.locals.runtime.env.DB;

  // Authenticate (supports both web session and API tokens) and require admin
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

  const parseResult = UpdateUserSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const input = parseResult.data;

  try {
    // Get member to update
    const member = await getMemberById(db, userId);
    if (!member) {
      return errorResponse('User not found', 404);
    }

    // Check if trying to demote from admin to member
    if (input.role === 'member' && member.role === 'admin') {
      // Count how many admins exist
      const adminCount = await db
        .prepare("SELECT COUNT(*) as count FROM members WHERE role = 'admin'")
        .first<{ count: number }>();

      if (adminCount && adminCount.count <= 1) {
        return errorResponse('Cannot demote the only admin. Promote another user first.', 400);
      }
    }

    // Update member
    await updateMember(db, userId, {
      role: input.role,
      display_name: input.display_name,
      email: input.email,
    });

    return successResponse({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    return errorResponse('Failed to update user', 500);
  }
}

export async function DELETE(context: APIContext) {
  const { request, params } = context;
  const userId = params.id as string;
  const db = context.locals.runtime.env.DB;

  // Authenticate (supports both web session and API tokens) and require admin
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  // Cannot delete yourself
  if (authResult.context.member.user_id === userId) {
    return errorResponse('Cannot remove yourself', 400);
  }

  try {
    // Get member to delete
    const member = await getMemberById(db, userId);
    if (!member) {
      return errorResponse('User not found', 404);
    }

    // If deleting an admin, ensure there's at least one other admin
    if (member.role === 'admin') {
      const adminCount = await db
        .prepare("SELECT COUNT(*) as count FROM members WHERE role = 'admin'")
        .first<{ count: number }>();

      if (adminCount && adminCount.count <= 1) {
        return errorResponse('Cannot remove the only admin. Promote another user first.', 400);
      }
    }

    await deleteMember(db, userId);

    return successResponse({ message: 'User removed successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    return errorResponse('Failed to remove user', 500);
  }
}
