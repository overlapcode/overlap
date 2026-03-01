/**
 * Heartbeat to Overlap Cloud (overlap.dev).
 * Sends anonymous instance stats once per day on dashboard page load.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { getTeamConfig } from './db/queries';
import { VERSION } from './version';

const HEARTBEAT_URL = 'https://overlap.dev/api/v1/heartbeat';
const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let lastHeartbeat = 0;

async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function maybeHeartbeat(db: D1Database): Promise<void> {
  if (Date.now() - lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
  lastHeartbeat = Date.now();

  const config = await getTeamConfig(db);
  if (!config) return;

  const memberCount = await db.prepare('SELECT COUNT(*) as c FROM members').first<{ c: number }>();
  const repoCount = await db.prepare('SELECT COUNT(*) as c FROM repos').first<{ c: number }>();

  // All-time overlap detection stats
  const overlapStats = await db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN decision = 'warn' THEN 1 ELSE 0 END) as warns,
      SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as blocks
    FROM overlaps
  `).first<{ total: number; warns: number; blocks: number }>();

  // Stable anonymous instance ID
  const instanceHash = await hashString(`${config.team_name}:${config.team_join_code}`);

  await fetch(HEARTBEAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instance_hash: instanceHash,
      version: VERSION,
      user_count: memberCount?.c ?? 0,
      repo_count: repoCount?.c ?? 0,
      total_overlaps: overlapStats?.total ?? 0,
      total_warns: overlapStats?.warns ?? 0,
      total_blocks: overlapStats?.blocks ?? 0,
    }),
    signal: AbortSignal.timeout(3000),
  });
}
