import type { ClassificationResult, LLMProvider } from './types';
import { buildPrompt, parseClassificationResponse } from './types';

const API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

export const openaiProvider: LLMProvider = {
  name: 'openai',

  async classify(files: string[], apiKey: string, model?: string): Promise<ClassificationResult> {
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
            content: buildPrompt(files),
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('OpenAI API error: status', response.status);
      throw new Error(`OpenAI API error: ${response.status}`);
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
