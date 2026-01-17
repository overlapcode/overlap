import { z } from 'zod';
import { authenticateRequest, requireAdmin, errorResponse, successResponse } from '@lib/auth/middleware';
import { updateTeamSettings } from '@lib/db/queries';
import { encrypt } from '@lib/utils/crypto';

const UpdateLLMSchema = z.object({
  provider: z.enum(['heuristic', 'anthropic', 'openai', 'xai', 'google']),
  model: z.string().optional(),
  api_key: z.string().optional(),
});

type Env = {
  DB: D1Database;
  TEAM_ENCRYPTION_KEY?: string;
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
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
      if (!env.TEAM_ENCRYPTION_KEY) {
        return errorResponse('Encryption key not configured', 500);
      }
      encryptedApiKey = await encrypt(input.api_key, env.TEAM_ENCRYPTION_KEY);
    }

    await updateTeamSettings(env.DB, team.id, {
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
};
