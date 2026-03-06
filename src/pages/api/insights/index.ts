/**
 * GET /api/insights - List insights for current user or team
 *
 * Query params:
 * - scope: 'user' | 'team' (default: 'user')
 * - periodType: 'week' | 'month' | 'quarter' | 'year' (optional filter)
 * - includeAvailable: '1' to include available (ungenerated) periods
 *
 * Auth: Web session
 */

import type { APIContext } from 'astro';
import { authenticateWebSession, errorResponse, successResponse } from '@lib/auth/middleware';
import { getInsights, upsertInsight } from '@lib/db/queries';
import { getEarliestSessionDate, getAvailablePeriods } from '@lib/insights';
import type { InsightPeriodType, InsightScope } from '@lib/db/types';

export async function GET(context: APIContext) {
  const db = context.locals.runtime.env.DB;

  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const url = new URL(context.request.url);
    const scope = (url.searchParams.get('scope') || 'user') as InsightScope;
    const periodType = url.searchParams.get('periodType') as InsightPeriodType | null;
    const includeAvailable = url.searchParams.get('includeAvailable') === '1';

    const userId = scope === 'user' ? authResult.context.member.user_id : null;

    const insights = await getInsights(db, scope, userId, periodType ?? undefined);

    // Auto-expire stuck "generating" insights (waitUntil may have been killed)
    const STUCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — larger models need more time
    const now = Date.now();
    for (const insight of insights) {
      if (insight.status === 'generating' && insight.created_at) {
        const created = new Date(insight.created_at + (insight.created_at.endsWith('Z') ? '' : 'Z')).getTime();
        if (now - created > STUCK_TIMEOUT_MS) {
          insight.status = 'failed';
          insight.error = 'Generation timed out. Try again — if it persists, the period may have too many sessions for the current model.';
          // Fire-and-forget DB update
          upsertInsight(db, {
            id: insight.id,
            scope: insight.scope,
            user_id: insight.user_id,
            period_type: insight.period_type,
            period_start: insight.period_start,
            period_end: insight.period_end,
            model_used: insight.model_used,
            status: 'failed',
            content: null,
            error: insight.error,
            generated_at: null,
          }).catch(e => console.error('Failed to expire stuck insight:', e));
        }
      }
    }

    let available: ReturnType<typeof getAvailablePeriods> = [];
    if (includeAvailable) {
      const earliest = await getEarliestSessionDate(db, scope, userId);
      if (earliest) {
        const types: InsightPeriodType[] = periodType ? [periodType] : ['week', 'month', 'quarter', 'year'];
        for (const t of types) {
          available = available.concat(getAvailablePeriods(t, earliest));
        }
      }
    }

    return successResponse({
      insights,
      available,
      member: {
        user_id: authResult.context.member.user_id,
        display_name: authResult.context.member.display_name,
        role: authResult.context.member.role,
      },
      team_name: authResult.context.teamConfig.team_name,
      has_llm: !!authResult.context.teamConfig.llm_provider && authResult.context.teamConfig.llm_provider !== 'heuristic',
      llm_provider: authResult.context.teamConfig.llm_provider,
    });
  } catch (error) {
    console.error('Insights list error:', error);
    return errorResponse('Failed to fetch insights', 500);
  }
}
