import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateAny, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { updateTeamSettings, getTeam } from '@lib/db/queries';
import { encrypt } from '@lib/utils/crypto';

const UpdateLLMSchema = z.object({
  provider: z.enum(['heuristic', 'anthropic', 'openai', 'xai', 'google']),
  model: z.string().optional(),
  api_key: z.string().optional(),
});

// GET: Retrieve LLM settings
export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate and require admin (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  try {
    const team = await getTeam(db);
    if (!team) {
      return errorResponse('Team not found', 404);
    }

    return successResponse({
      provider: team.llm_provider,
      model: team.llm_model,
      has_api_key: !!team.llm_api_key_encrypted,
    });
  } catch (error) {
    console.error('Get LLM settings error:', error);
    return errorResponse('Failed to get LLM settings', 500);
  }
}

// PUT: Update LLM settings
export async function PUT(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;
  const encryptionKey = context.locals.runtime.env.TEAM_ENCRYPTION_KEY;

  // Authenticate and require admin (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  const adminCheck = requireAdmin(authResult.context);
  if (!adminCheck.success) {
    return errorResponse(adminCheck.error, adminCheck.status);
  }

  const { team } = authResult.context;

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parseResult = UpdateLLMSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(`Validation error: ${parseResult.error.message}`, 400);
  }

  const input = parseResult.data;

  try {
    // If provider is not heuristic and API key is provided, encrypt it
    let encryptedApiKey: string | null = null;
    if (input.provider !== 'heuristic' && input.api_key) {
      if (!encryptionKey) {
        return errorResponse('Encryption key not configured', 500);
      }
      encryptedApiKey = await encrypt(input.api_key, encryptionKey);
    }

    await updateTeamSettings(db, team.id, {
      llm_provider: input.provider,
      llm_model: input.model ?? null,
      llm_api_key_encrypted: encryptedApiKey,
    });

    return successResponse({
      message: 'LLM settings updated successfully',
      provider: input.provider,
      model: input.model,
    });
  } catch (error) {
    console.error('Update LLM error:', error);
    return errorResponse('Failed to update LLM settings', 500);
  }
}
