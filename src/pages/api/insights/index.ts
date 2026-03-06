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
import { getInsights } from '@lib/db/queries';
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
