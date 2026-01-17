import { authenticateRequest, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { getTeamRepos } from '@lib/db/queries';

type Env = {
  DB: D1Database;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Authenticate and require admin
  const authResult = await authenticateRequest(request, env.DB);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  const { team } = authResult.context;

  try {
    const repos = await getTeamRepos(env.DB, team.id);

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
};
