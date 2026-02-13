import type { APIContext } from 'astro';
import { authenticateAny, isAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getAllRepos } from '@lib/db/queries';

export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const repos = await getAllRepos(db);

    return successResponse({
      repos: repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        display_name: repo.display_name,
        description: repo.description,
        created_at: repo.created_at,
      })),
      is_admin: isAdmin(authResult.context),
    });
  } catch (error) {
    console.error('List repos error:', error);
    return errorResponse('Failed to list repos', 500);
  }
}
