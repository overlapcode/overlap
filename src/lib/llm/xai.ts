import type { ClassificationResult, LLMProvider } from './types';
import { buildPrompt, parseClassificationResponse } from './types';

const API_URL = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = 'grok-4-fast-non-reasoning';

export const xaiProvider: LLMProvider = {
  name: 'xai',

  async classify(files: string[], apiKey: string, model?: string, toolName?: string): Promise<ClassificationResult> {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
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
      console.error('xAI API error: status', response.status);
      throw new Error(`xAI API error: ${response.status}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in response');
    }

    return parseClassificationResponse(content);
  },
};
