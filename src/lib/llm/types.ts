// LLM Provider Types

export type ClassificationResult = {
  scope: string;
  summary: string;
};

export type LLMProvider = {
  name: string;
  classify(files: string[], apiKey: string, model?: string, toolName?: string): Promise<ClassificationResult>;
};

export type LLMProviderName = 'anthropic' | 'openai' | 'xai' | 'google' | 'heuristic';

// Common classification prompt
export const CLASSIFICATION_PROMPT = `Analyze the following file paths and classify what area of the codebase is being worked on.

Operation: {operation}

Files:
{files}

Respond with a JSON object containing:
- scope: A short lowercase label for the work area (e.g., "authentication", "payments", "api-endpoints", "testing", "frontend", "database")
- summary: A brief one-sentence description of what's being done. Use verbs appropriate to the operation (e.g., "Reading..." for reads, "Editing..." for edits, "Searching..." for searches, "Running..." for commands).

Respond ONLY with valid JSON, no markdown or explanation.`;

/**
 * Map a tool name to a human-readable operation label for the LLM prompt.
 */
function getOperationLabel(toolName?: string): string {
  if (!toolName) return 'Editing files';
  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'Editing files';
    case 'Read':
      return 'Reading files';
    case 'Grep':
      return 'Searching code';
    case 'Glob':
      return 'Finding files';
    case 'Bash':
      return 'Running a command';
    default:
      return `Using ${toolName}`;
  }
}

export function buildPrompt(files: string[], toolName?: string): string {
  const sanitized = files
    .slice(0, 50)
    .map(f => f.replace(/[\x00-\x1f\x7f]/g, '').substring(0, 500));
  return CLASSIFICATION_PROMPT
    .replace('{operation}', getOperationLabel(toolName))
    .replace('{files}', sanitized.map((f) => `- ${f}`).join('\n'));
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
