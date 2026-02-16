/**
 * Shared utilities for GitHub URL parsing and file path handling.
 * Used by ActivityCard and SessionDetail components.
 */

/** Parse git remote URL to GitHub web URL */
export function parseGitHubUrl(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;

  // Handle SSH format: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }

  // Handle HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}`;
  }

  // Handle plain HTTPS without .git
  if (remoteUrl.startsWith('https://github.com/')) {
    return remoteUrl.replace(/\.git$/, '');
  }

  return null;
}

/** Get relative file path by stripping worktree prefix */
export function getRelativeFilePath(absolutePath: string, worktree: string | null): string {
  if (!worktree) return absolutePath;

  // Normalize paths (remove trailing slashes)
  const normalizedWorktree = worktree.replace(/\/+$/, '');

  if (absolutePath.startsWith(normalizedWorktree + '/')) {
    return absolutePath.slice(normalizedWorktree.length + 1);
  }

  return absolutePath;
}

/** Get human-readable status label */
export function getStatusLabel(status: string): string {
  switch (status) {
    case 'active': return 'ACTIVE';
    case 'stale': return 'STALE';
    case 'ended': return 'ENDED';
    default: return status.toUpperCase();
  }
}

/** Get display name for a coding agent type */
export function getAgentLabel(agentType: string | null | undefined): string {
  if (!agentType) return 'Agent';
  switch (agentType) {
    case 'claude_code': return 'Claude';
    case 'codex': return 'Codex';
    case 'cursor': return 'Cursor';
    case 'windsurf': return 'Windsurf';
    case 'copilot': return 'Copilot';
    case 'aider': return 'Aider';
    case 'cline': return 'Cline';
    case 'devin': return 'Devin';
    default: return agentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/** Encode a branch name for use in GitHub URLs, preserving `/` separators */
export function encodeBranchForUrl(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

/** Build a GitHub branch URL */
export function getBranchUrl(githubBaseUrl: string | null, branch: string | null): string | null {
  if (!githubBaseUrl || !branch) return null;
  return `${githubBaseUrl}/tree/${encodeBranchForUrl(branch)}`;
}

/** Derive a GitHub URL from a repo name like "owner/repo" */
export function deriveGitHubUrl(repoName: string | null | undefined): string | null {
  if (!repoName) return null;
  // Match "owner/repo" pattern (no slashes beyond the single separator)
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repoName)) {
    return `https://github.com/${repoName}`;
  }
  return null;
}

/** Strip repo root from an absolute path using repo name as a heuristic.
 * e.g. repoName="owner/my-app", path="/Users/me/work/my-app/src/index.ts" → "src/index.ts"
 * Falls back to the basename segments if no match. */
export function stripRepoRoot(filePath: string, repoName: string | null): string {
  if (!repoName || !filePath.startsWith('/')) return filePath;
  const repoDir = repoName.includes('/') ? repoName.split('/').pop()! : repoName;
  const marker = `/${repoDir}/`;
  const idx = filePath.indexOf(marker);
  if (idx !== -1) {
    return filePath.slice(idx + marker.length);
  }
  return filePath;
}

/** Build a GitHub file URL from a file path, repo URL, and branch */
export function getFileUrl(
  filePath: string,
  githubBaseUrl: string | null,
  branch: string | null,
  worktree: string | null
): string | null {
  if (!githubBaseUrl || !branch) return null;
  const relativePath = getRelativeFilePath(filePath, worktree);
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  return `${githubBaseUrl}/blob/${encodeBranchForUrl(branch)}/${encodedPath}`;
}
