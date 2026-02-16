/**
 * GET /api/v1/repos - List registered repos (for tracer binary)
 * POST /api/v1/repos - Register a new repo (admin only)
 *
 * Auth: Bearer {user_token} for GET, web session for POST
 */

import type { APIContext } from 'astro';
import { z } from 'zod';
import {
  authenticateTracer,
  authenticateWebSession,
  errorResponse,
  successResponse,
  generateId,
} from '@lib/auth/middleware';
import { getAllRepos, createRepo, backfillRepoId } from '@lib/db/queries';

// GET /api/v1/repos - List repos (tracer pulls this)
export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Try tracer auth first, then web session
  let authResult = await authenticateTracer(context.request, db);
  if (!authResult.success) {
    authResult = await authenticateWebSession(context.request, db);
  }

  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const repos = await getAllRepos(db);

  return successResponse({
    repos: repos.map((r) => ({
      id: r.id,
      name: r.name,
      display_name: r.display_name,
    })),
  });
}

// POST /api/v1/repos - Register a new repo (admin only)
const CreateRepoSchema = z.object({
  name: z.string().min(1).max(100),
  display_name: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
});

export async function POST(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Require web session auth (admin action)
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Parse request body
  let body: z.infer<typeof CreateRepoSchema>;
  try {
    const json = await context.request.json();
    body = CreateRepoSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
    }
    return errorResponse('Invalid JSON payload', 400);
  }

  // Create repo
  const repo = await createRepo(db, {
    id: generateId(),
    name: body.name,
    display_name: body.display_name,
    description: body.description,
  });

  // Backfill repo_id on existing rows that have matching repo_name but no repo_id
  await backfillRepoId(db, repo.id, repo.name);

  return successResponse(repo, 201);
}

// PUT /api/v1/repos - Not supported at this route
export async function PUT() {
  return errorResponse('Use PUT /api/v1/repos/{id} to update a repo', 405);
}

// DELETE /api/v1/repos - Not supported at this route
export async function DELETE() {
  return errorResponse('Use DELETE /api/v1/repos/{id} to delete a repo', 405);
}
