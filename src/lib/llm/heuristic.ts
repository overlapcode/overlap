import type { ClassificationResult, LLMProvider } from './types';

// Path-based heuristic patterns for classification
const SCOPE_PATTERNS: [RegExp, string, string][] = [
  [/auth|login|session|oauth|jwt|password|signup|signin/i, 'authentication', 'Working on authentication'],
  [/pay|billing|stripe|checkout|subscription|invoice/i, 'payments', 'Working on payment processing'],
  [/api|route|endpoint|controller|handler|middleware/i, 'api-endpoints', 'Working on API endpoints'],
  [/model|schema|migration|entity|database|db|sql/i, 'data-models', 'Working on data models'],
  [/test|spec|__test__|mock|fixture|cypress|playwright/i, 'testing', 'Working on tests'],
  [/component|view|page|ui|style|css|scss|tailwind/i, 'frontend', 'Working on frontend'],
  [/doc|readme|changelog|guide|tutorial/i, 'documentation', 'Working on documentation'],
  [/config|env|setting|option/i, 'configuration', 'Working on configuration'],
  [/util|helper|lib|common|shared/i, 'utilities', 'Working on utilities'],
  [/deploy|ci|cd|docker|k8s|terraform|infra/i, 'infrastructure', 'Working on infrastructure'],
  [/email|mail|notification|message|alert/i, 'notifications', 'Working on notifications'],
  [/user|profile|account|member/i, 'user-management', 'Working on user management'],
  [/search|filter|query|index/i, 'search', 'Working on search functionality'],
  [/upload|file|storage|asset|media|image/i, 'file-handling', 'Working on file handling'],
  [/cache|redis|memcache/i, 'caching', 'Working on caching'],
  [/log|metric|monitor|trace|observability/i, 'observability', 'Working on observability'],
  [/security|permission|role|acl|rbac/i, 'security', 'Working on security'],
  [/websocket|socket|realtime|sse|stream/i, 'realtime', 'Working on real-time features'],
];

/**
 * Map tool name to a verb for heuristic summaries.
 */
function getVerb(toolName?: string): string {
  if (!toolName) return 'Editing';
  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'Editing';
    case 'Read':
      return 'Reading';
    case 'Grep':
      return 'Searching';
    case 'Glob':
      return 'Finding files in';
    case 'Bash':
      return 'Running command in';
    default:
      return 'Working on';
  }
}

function classifyByPath(files: string[], toolName?: string): ClassificationResult {
  const scopeCounts = new Map<string, number>();
  let matchedScope = 'general';
  let matchedSummary = 'Working on code';

  for (const file of files) {
    for (const [pattern, scope, summary] of SCOPE_PATTERNS) {
      if (pattern.test(file)) {
        const count = (scopeCounts.get(scope) || 0) + 1;
        scopeCounts.set(scope, count);
        if (count > (scopeCounts.get(matchedScope) || 0)) {
          matchedScope = scope;
          matchedSummary = summary;
        }
        break; // Only match first pattern per file
      }
    }
  }

  const verb = getVerb(toolName);

  // Generate more specific summary based on files and operation
  if (toolName === 'Bash') {
    // For bash commands, the "file" is actually the command text
    matchedSummary = 'Running a command';
  } else if (files.length === 1) {
    const fileName = files[0].split('/').pop() || files[0];
    matchedSummary = `${verb} ${fileName}`;
  } else if (files.length <= 3) {
    const fileNames = files.map((f) => f.split('/').pop()).join(', ');
    matchedSummary = `${verb} ${fileNames}`;
  } else {
    matchedSummary = `${matchedSummary} (${files.length} files)`;
  }

  return {
    scope: matchedScope,
    summary: matchedSummary,
  };
}

export const heuristicProvider: LLMProvider = {
  name: 'heuristic',

  async classify(files: string[], _apiKey: string, _model?: string, toolName?: string): Promise<ClassificationResult> {
    return classifyByPath(files, toolName);
  },
};
