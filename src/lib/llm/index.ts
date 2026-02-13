import type { TeamConfig } from '@lib/db/types';
import { decrypt } from '@lib/utils/crypto';
import type { ClassificationResult, LLMProvider, LLMProviderName } from './types';
import { heuristicProvider } from './heuristic';
import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import { xaiProvider } from './xai';
import { googleProvider } from './google';

export type { ClassificationResult, LLMProvider, LLMProviderName };

const providers: Record<LLMProviderName, LLMProvider> = {
  heuristic: heuristicProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
  xai: xaiProvider,
  google: googleProvider,
};

export function getProvider(name: LLMProviderName): LLMProvider {
  const provider = providers[name];
  if (!provider) {
    console.warn(`Unknown LLM provider: ${name}, falling back to heuristic`);
    return heuristicProvider;
  }
  return provider;
}

/**
 * Classify files using the team's configured LLM provider.
 * Falls back to heuristic if LLM fails or is not configured.
 */
export async function classifyActivity(
  teamConfig: TeamConfig,
  files: string[],
  encryptionKey?: string,
  toolName?: string
): Promise<ClassificationResult> {
  const providerName = teamConfig.llm_provider as LLMProviderName;

  // Use heuristic if no provider configured or no API key
  if (providerName === 'heuristic' || !teamConfig.llm_api_key_encrypted) {
    return heuristicProvider.classify(files, '', undefined, toolName);
  }

  // Need encryption key to decrypt API key
  if (!encryptionKey) {
    console.warn('No encryption key available, falling back to heuristic');
    return heuristicProvider.classify(files, '', undefined, toolName);
  }

  try {
    // Decrypt API key
    const apiKey = await decrypt(teamConfig.llm_api_key_encrypted!, encryptionKey);
    const provider = getProvider(providerName);

    // Try LLM classification
    return await provider.classify(files, apiKey, teamConfig.llm_model ?? undefined, toolName);
  } catch (error) {
    const sanitizedError = error instanceof Error
      ? error.message
          // Redact common API key patterns: sk-xxx, xai-xxx, key-xxx, Bearer tokens
          .replace(/\b(sk-|xai-|key-|AIza)[A-Za-z0-9_\-]{10,}\b/g, '[REDACTED_KEY]')
          .replace(/\bBearer\s+[A-Za-z0-9_\-.]{10,}\b/g, 'Bearer [REDACTED_KEY]')
      : 'Classification failed';
    console.error('LLM classification failed, falling back to heuristic:', sanitizedError);
    return heuristicProvider.classify(files, '', undefined, toolName);
  }
}
