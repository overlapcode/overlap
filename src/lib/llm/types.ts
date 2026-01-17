// LLM Provider Types

export type ClassificationResult = {
  scope: string;
  summary: string;
};

export type LLMProvider = {
  name: string;
  classify(files: string[], apiKey: string, model?: string): Promise<ClassificationResult>;
};

export type LLMProviderName = 'anthropic' | 'openai' | 'xai' | 'google' | 'heuristic';

// Common classification prompt
export const CLASSIFICATION_PROMPT = `Analyze the following file paths and classify what area of the codebase is being worked on.

Files:
{files}

Respond with a JSON object containing:
- scope: A short lowercase label for the work area (e.g., "authentication", "payments", "api-endpoints", "testing", "frontend", "database")
- summary: A brief one-sentence description of what's being worked on

Respond ONLY with valid JSON, no markdown or explanation.`;

export function buildPrompt(files: string[]): string {
  return CLASSIFICATION_PROMPT.replace('{files}', files.map((f) => `- ${f}`).join('\n'));
}

export function parseClassificationResponse(response: string): ClassificationResult {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      scope: String(parsed.scope || 'unknown').toLowerCase(),
      summary: String(parsed.summary || 'Working on code'),
    };
  } catch {
    return {
      scope: 'unknown',
      summary: 'Working on code',
    };
  }
}
