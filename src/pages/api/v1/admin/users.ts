import type { APIContext } from 'astro';
import { authenticateAny, isAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getAllMembers } from '@lib/db/queries';

// GET: List team members (accessible by all authenticated users)
export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const members = await getAllMembers(db);

    return successResponse({
      users: members.map((member) => ({
        id: member.user_id,
        name: member.display_name,
        email: member.email,
        role: member.role,
        last_active_at: member.last_active_at,
        created_at: member.created_at,
      })),
      is_admin: isAdmin(authResult.context),
      current_user_id: authResult.context.member.user_id,
    });
  } catch (error) {
    console.error('List users error:', error);
    return errorResponse('Failed to list users', 500);
  }
}
