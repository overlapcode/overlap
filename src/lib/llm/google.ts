import type { ClassificationResult, LLMProvider } from './types';
import { buildPrompt, parseClassificationResponse } from './types';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';

export const googleProvider: LLMProvider = {
  name: 'google',

  async classify(files: string[], apiKey: string, model?: string): Promise<ClassificationResult> {
    const modelName = model || DEFAULT_MODEL;
    const url = `${API_URL}/${modelName}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: buildPrompt(files),
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 256,
        },
      }),
    });

    if (!response.ok) {
      console.error('Google API error: status', response.status);
      throw new Error(`Google API error: ${response.status}`);
    }

    const data = await response.json() as {
      candidates: Array<{
        content: {
          parts: Array<{ text: string }>;
        };
      }>;
    };

    const content = data.candidates[0]?.content?.parts[0]?.text;
    if (!content) {
      throw new Error('No content in response');
    }

    return parseClassificationResponse(content);
  },
};
