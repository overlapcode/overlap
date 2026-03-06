/**
 * Heartbeat to Overlap Cloud (overlap.dev).
 * Sends anonymous instance stats once per day on dashboard page load.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { getTeamConfig, estimateCostFromTokens } from './db/queries';
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

export async function maybeHeartbeat(db: D1Database, instanceUrl: string): Promise<void> {
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

  // Estimated savings from overlaps (all-time)
  const savingsRows = await db.prepare(`
    SELECT
      o.decision,
      sa.total_cost_usd as cost_a, sa.total_input_tokens as input_a, sa.total_output_tokens as output_a,
      sa.cache_creation_tokens as cache_create_a, sa.cache_read_tokens as cache_read_a, sa.model as model_a,
      sb.total_cost_usd as cost_b, sb.total_input_tokens as input_b, sb.total_output_tokens as output_b,
      sb.cache_creation_tokens as cache_create_b, sb.cache_read_tokens as cache_read_b, sb.model as model_b
    FROM overlaps o
    LEFT JOIN sessions sa ON o.session_id_a = sa.id
    LEFT JOIN sessions sb ON o.session_id_b = sb.id
  `).all();

  let estimatedSavings = 0;
  for (const row of savingsRows.results as Record<string, unknown>[]) {
    const rawCostA = row.cost_a as number | null;
    const costA = (rawCostA != null && rawCostA > 0) ? rawCostA : estimateCostFromTokens(
      row.model_a as string | null, row.input_a as number | null, row.output_a as number | null,
      row.cache_create_a as number | null, row.cache_read_a as number | null,
    );
    const rawCostB = row.cost_b as number | null;
    const costB = (rawCostB != null && rawCostB > 0) ? rawCostB : estimateCostFromTokens(
      row.model_b as string | null, row.input_b as number | null, row.output_b as number | null,
      row.cache_create_b as number | null, row.cache_read_b as number | null,
    );
    const maxCost = Math.max(costA, costB);
    if (row.decision === 'block') estimatedSavings += maxCost;
    else if (row.decision === 'warn') estimatedSavings += maxCost * 0.5;
  }

  // Stable anonymous instance ID — must match tracer's hash (which hashes instance_url)
  const instanceHash = await hashString(instanceUrl);

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
      estimated_savings_usd: Math.round(estimatedSavings * 100) / 100,
    }),
    signal: AbortSignal.timeout(3000),
  });
}
