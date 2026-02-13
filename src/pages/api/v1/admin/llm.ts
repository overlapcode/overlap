import type { APIContext } from 'astro';
import { z } from 'zod';
import { authenticateAny, requireAdmin, isAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { updateTeamConfig, getTeamConfig } from '@lib/db/queries';
import { encrypt } from '@lib/utils/crypto';

const UpdateLLMSchema = z.object({
  provider: z.enum(['heuristic', 'anthropic', 'openai', 'xai', 'google']),
  model: z.string().optional(),
  api_key: z.string().optional(),
});

// GET: Retrieve LLM settings (accessible by all authenticated users)
export async function GET(context: APIContext) {
  const { request } = context;
  const db = context.locals.runtime.env.DB;

  // Authenticate (supports both web session and API tokens)
  const authResult = await authenticateAny(request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const config = await getTeamConfig(db);
    if (!config) {
      return errorResponse('Team not configured', 404);
    }

    return successResponse({
      provider: config.llm_provider,
      model: config.llm_model,
      has_api_key: !!config.llm_api_key_encrypted,
      is_admin: isAdmin(authResult.context),
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

    await updateTeamConfig(db, {
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
