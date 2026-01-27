import type { ClassificationResult, LLMProvider } from './types';
import { buildPrompt, parseClassificationResponse } from './types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-3-5-haiku-latest';

export const anthropicProvider: LLMProvider = {
  name: 'anthropic',

  async classify(files: string[], apiKey: string, model?: string, toolName?: string): Promise<ClassificationResult> {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: buildPrompt(files, toolName),
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('Anthropic API error: status', response.status);
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const textContent = data.content.find((c) => c.type === 'text');
    if (!textContent?.text) {
      throw new Error('No text content in response');
    }

    return parseClassificationResponse(textContent.text);
  },
};
