/**
 * POST /api/insights/auto-generate - Auto-generate due insights sequentially
 *
 * Finds the next due insight (team or per-member) that hasn't been generated,
 * generates it, then self-fetches to chain to the next one. Each call is a
 * separate Worker invocation with its own CPU budget.
 *
 * Priority order:
 *   1. Team insights (most visible)
 *   2. Per-member insights (alphabetical by name)
 *   Within each: week > month > quarter > year
 *
 * Safety:
 *   - Skips if any insight is currently generating (prevents parallel runs)
 *   - Resets stuck "generating" insights older than 10 minutes
 *   - Uses TEAM_ENCRYPTION_KEY as internal auth (every instance has this)
 *
 * Auth: Internal (X-Internal-Secret header must match TEAM_ENCRYPTION_KEY)
 */

import type { APIContext } from 'astro';
import { successResponse, errorResponse } from '@lib/auth/middleware';
import {
  getTeamConfig,
  getAllMembers,
  getInsightByPeriod,
  upsertInsight,
  getInsights,
} from '@lib/db/queries';
import {
  getAvailablePeriods,
  getEarliestSessionDate,
  runInsightGeneration,
} from '@lib/insights';
import type { InsightPeriodType, InsightScope } from '@lib/db/types';

const PERIOD_TYPES: InsightPeriodType[] = ['week', 'month', 'quarter', 'year'];
const STUCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

type DueInsight = {
  scope: InsightScope;
  userId: string | null;
  scopeDetail: string;
  periodType: InsightPeriodType;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
};

export async function POST(context: APIContext) {
  const db = context.locals.runtime.env.DB;
  const encryptionKey = context.locals.runtime.env.TEAM_ENCRYPTION_KEY;

  // Auth: verify internal secret
  const secret = context.request.headers.get('X-Internal-Secret');
  if (!encryptionKey || secret !== encryptionKey) {
    return errorResponse('Unauthorized', 401);
  }

  const teamConfig = await getTeamConfig(db);
  if (!teamConfig?.llm_provider || teamConfig.llm_provider === 'heuristic') {
    return successResponse({ message: 'No LLM provider configured, skipping auto-generate' });
  }

  // Reset stuck "generating" insights
  const allInsights = await getInsights(db, 'team', null);
  const now = Date.now();
  for (const insight of allInsights) {
    if (insight.status === 'generating' && insight.created_at) {
      const created = new Date(insight.created_at + (insight.created_at.endsWith('Z') ? '' : 'Z')).getTime();
      if (now - created > STUCK_TIMEOUT_MS) {
        console.log(`[auto-generate] Resetting stuck insight ${insight.id} (${insight.period_start})`);
        await upsertInsight(db, {
          id: insight.id, scope: insight.scope, user_id: insight.user_id,
          period_type: insight.period_type, period_start: insight.period_start,
          period_end: insight.period_end, model_used: insight.model_used,
          status: 'failed', content: null,
          error: 'Generation timed out (auto-reset)', generated_at: null,
        });
      } else {
        // Something is actively generating — don't start another
        console.log(`[auto-generate] Insight ${insight.id} is actively generating, skipping`);
        return successResponse({ message: 'Generation already in progress', active: insight.id });
      }
    }
  }

  // Also check user-scoped insights for active generation
  const members = await getAllMembers(db);
  for (const member of members) {
    const userInsights = await getInsights(db, 'user', member.user_id);
    for (const insight of userInsights) {
      if (insight.status === 'generating' && insight.created_at) {
        const created = new Date(insight.created_at + (insight.created_at.endsWith('Z') ? '' : 'Z')).getTime();
        if (now - created > STUCK_TIMEOUT_MS) {
          await upsertInsight(db, {
            id: insight.id, scope: insight.scope, user_id: insight.user_id,
            period_type: insight.period_type, period_start: insight.period_start,
            period_end: insight.period_end, model_used: insight.model_used,
            status: 'failed', content: null,
            error: 'Generation timed out (auto-reset)', generated_at: null,
          });
        } else {
          console.log(`[auto-generate] User insight ${insight.id} is actively generating, skipping`);
          return successResponse({ message: 'Generation already in progress', active: insight.id });
        }
      }
    }
  }

  // Find all due insights that don't exist yet
  const dueInsights: DueInsight[] = [];

  // Team insights
  const teamEarliest = await getEarliestSessionDate(db, 'team', null);
  if (teamEarliest) {
    for (const periodType of PERIOD_TYPES) {
      const periods = getAvailablePeriods(periodType, teamEarliest);
      for (const period of periods) {
        const existing = await getInsightByPeriod(db, 'team', null, periodType, period.start);
        if (!existing || existing.status === 'failed') {
          dueInsights.push({
            scope: 'team',
            userId: null,
            scopeDetail: teamConfig.team_name,
            periodType,
            periodStart: period.start,
            periodEnd: period.end,
            periodLabel: period.label,
          });
        }
      }
    }
  }

  // Per-member insights
  for (const member of members) {
    const memberEarliest = await getEarliestSessionDate(db, 'user', member.user_id);
    if (!memberEarliest) continue;

    for (const periodType of PERIOD_TYPES) {
      const periods = getAvailablePeriods(periodType, memberEarliest);
      for (const period of periods) {
        const existing = await getInsightByPeriod(db, 'user', member.user_id, periodType, period.start);
        if (!existing || existing.status === 'failed') {
          dueInsights.push({
            scope: 'user',
            userId: member.user_id,
            scopeDetail: member.display_name,
            periodType,
            periodStart: period.start,
            periodEnd: period.end,
            periodLabel: period.label,
          });
        }
      }
    }
  }

  if (dueInsights.length === 0) {
    console.log('[auto-generate] No due insights found');
    return successResponse({ message: 'All insights up to date', due: 0 });
  }

  // Pick the first due insight and generate it
  const next = dueInsights[0];
  console.log(`[auto-generate] Generating ${next.scope}/${next.scopeDetail} ${next.periodType} ${next.periodStart} (${dueInsights.length} total due)`);

  const insightId = crypto.randomUUID();
  await upsertInsight(db, {
    id: insightId, scope: next.scope, user_id: next.userId,
    period_type: next.periodType, period_start: next.periodStart,
    period_end: next.periodEnd, model_used: teamConfig.llm_model || null,
    status: 'generating', content: null, error: null, generated_at: null,
  });

  const result = await runInsightGeneration(db, {
    insightId,
    scope: next.scope,
    userId: next.userId,
    periodType: next.periodType,
    periodStart: next.periodStart,
    periodEnd: next.periodEnd,
    periodLabel: next.periodLabel,
    scopeDetail: next.scopeDetail,
    model: null,
    encryptionKey: encryptionKey || '',
  });

  console.log(`[auto-generate] ${next.scope}/${next.scopeDetail} ${next.periodType} ${next.periodStart} → ${result.status}`);

  // Chain: self-fetch to process the next due insight
  const remaining = dueInsights.length - 1;
  if (remaining > 0) {
    const selfUrl = new URL('/api/insights/auto-generate', context.request.url).toString();
    console.log(`[auto-generate] Chaining to next (${remaining} remaining)`);
    // Use waitUntil so we don't block the response
    context.locals.runtime.ctx.waitUntil(
      fetch(selfUrl, {
        method: 'POST',
        headers: { 'X-Internal-Secret': encryptionKey },
      }).catch(err => console.error('[auto-generate] Chain fetch failed:', err))
    );
  }

  return successResponse({
    message: `Generated ${next.scope} ${next.periodType} insight for ${next.periodStart}`,
    status: result.status,
    remaining,
  });
}
