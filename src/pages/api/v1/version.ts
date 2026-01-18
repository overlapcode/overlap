/**
 * Version endpoint for update checking.
 */

import type { APIContext } from 'astro';
import { successResponse } from '@lib/auth/middleware';

// This should match package.json version
const VERSION = '0.1.8';
const REPO = 'overlapcode/overlap';

export async function GET(_context: APIContext) {
  return successResponse({
    version: VERSION,
    repository: `https://github.com/${REPO}`,
    releases: `https://github.com/${REPO}/releases`,
    latest_check: `https://api.github.com/repos/${REPO}/releases/latest`,
  });
}
