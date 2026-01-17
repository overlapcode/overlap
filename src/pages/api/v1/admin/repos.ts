import type { APIContext } from 'astro';
import { authenticateRequest, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getTeamRepos } from '@lib/db/queries';

export async function GET(context: APIContext) {
  const { request } = context;
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

  const { team } = authResult.context;

  try {
    const repos = await getTeamRepos(db, team.id);

    return successResponse({
      repos: repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        remote_url: repo.remote_url,
        is_public: repo.is_public === 1,
        created_at: repo.created_at,
      })),
    });
  } catch (error) {
    console.error('List repos error:', error);
    return errorResponse('Failed to list repos', 500);
  }
}
