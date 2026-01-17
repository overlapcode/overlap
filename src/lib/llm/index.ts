import type { Team } from '@lib/db/types';
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
  team: Team,
  files: string[],
  encryptionKey?: string
): Promise<ClassificationResult> {
  const providerName = team.llm_provider as LLMProviderName;

  // Use heuristic if no provider configured or no API key
  if (providerName === 'heuristic' || !team.llm_api_key_encrypted) {
    return heuristicProvider.classify(files, '');
  }

  // Need encryption key to decrypt API key
  if (!encryptionKey) {
    console.warn('No encryption key available, falling back to heuristic');
    return heuristicProvider.classify(files, '');
  }

  try {
    // Decrypt API key
    const apiKey = await decrypt(team.llm_api_key_encrypted, encryptionKey);
    const provider = getProvider(providerName);

    // Try LLM classification
    return await provider.classify(files, apiKey, team.llm_model ?? undefined);
  } catch (error) {
    console.error('LLM classification failed, falling back to heuristic:', error);
    return heuristicProvider.classify(files, '');
  }
}
