/**
 * GET /api/settings - Get team settings
 * PUT /api/settings - Update team settings
 *
 * Auth: Web session (admin only)
 */

import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateWebSession, errorResponse, successResponse } from '@lib/auth/middleware';
import { getTeamConfig, updateTeamConfig } from '@lib/db/queries';
import { encrypt } from '@lib/utils/crypto';

// GET /api/settings
export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Require web session auth
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const config = await getTeamConfig(db);
  if (!config) {
    return errorResponse('Team not configured', 500);
  }

  // Don't return the encrypted API key
  return successResponse({
    team_name: config.team_name,
    stale_timeout_hours: config.stale_timeout_hours,
    llm_provider: config.llm_provider,
    llm_model: config.llm_model,
    llm_api_key_configured: !!config.llm_api_key_encrypted,
  });
}

// PUT /api/settings
const UpdateSettingsSchema = z.object({
  team_name: z.string().min(1).max(100).optional(),
  stale_timeout_hours: z.number().min(1).max(168).optional(), // 1 hour to 1 week
  llm_provider: z.enum(['anthropic', 'openai', 'xai', 'google']).nullable().optional(),
  llm_model: z.string().max(100).nullable().optional(),
  llm_api_key: z.string().max(500).nullable().optional(), // Raw API key, will be encrypted
});

export async function PUT(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  // Require web session auth
  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  // Parse request body
  let body: z.infer<typeof UpdateSettingsSchema>;
  try {
    const json = await context.request.json();
    body = UpdateSettingsSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
    }
    return errorResponse('Invalid JSON payload', 400);
  }

  // Build updates
  const updates: Parameters<typeof updateTeamConfig>[1] = {};

  if (body.team_name !== undefined) {
    updates.team_name = body.team_name;
  }
  if (body.stale_timeout_hours !== undefined) {
    updates.stale_timeout_hours = body.stale_timeout_hours;
  }
  if (body.llm_provider !== undefined) {
    updates.llm_provider = body.llm_provider;
  }
  if (body.llm_model !== undefined) {
    updates.llm_model = body.llm_model;
  }

  // Handle API key encryption
  if (body.llm_api_key !== undefined) {
    if (body.llm_api_key === null) {
      // Clear the API key
      updates.llm_api_key_encrypted = null;
    } else {
      // Encrypt the API key
      const encryptionKey = context.locals.runtime.env.TEAM_ENCRYPTION_KEY;
      if (!encryptionKey) {
        return errorResponse('TEAM_ENCRYPTION_KEY not configured', 500);
      }
      updates.llm_api_key_encrypted = await encrypt(body.llm_api_key, encryptionKey);
    }
  }

  await updateTeamConfig(db, updates);

  // Return updated settings
  const config = await getTeamConfig(db);
  return successResponse({
    team_name: config!.team_name,
    stale_timeout_hours: config!.stale_timeout_hours,
    llm_provider: config!.llm_provider,
    llm_model: config!.llm_model,
    llm_api_key_configured: !!config!.llm_api_key_encrypted,
  });
}
