/**
 * POST /api/insights/generate - Generate insight for a specific period
 *
 * Two-layer pipeline:
 *   Layer 1: Generate per-session facets (if not already cached)
 *   Layer 2: Aggregate facets + stats, synthesize rich narrative report
 *
 * Runs synchronously — Cloudflare's CPU time limit doesn't count I/O waits
 * (LLM API calls), so this can run for minutes of wall-clock time.
 *
 * Body:
 * - scope: 'user' | 'team'
 * - periodType: 'week' | 'month' | 'quarter' | 'year'
 * - periodStart: 'YYYY-MM-DD'
 * - periodEnd: 'YYYY-MM-DD'
 * - model?: string (LLM model override)
 * - regenerate?: boolean (force regeneration)
 *
 * Auth: Web session (team scope requires admin)
 */

import type { APIContext } from 'astro';
import { authenticateWebSession, errorResponse, successResponse, requireAdmin } from '@lib/auth/middleware';
import { getInsightByPeriod, upsertInsight } from '@lib/db/queries';
import { getAvailablePeriods, runInsightGeneration } from '@lib/insights';
import type { InsightPeriodType, InsightScope } from '@lib/db/types';

export async function POST(context: APIContext) {
  const db = context.locals.runtime.env.DB;
  const encryptionKey = context.locals.runtime.env.TEAM_ENCRYPTION_KEY;

  const authResult = await authenticateWebSession(context.request, db);
  if (!authResult.success) {
    return errorResponse(authResult.error, authResult.status);
  }

  try {
    const body = await context.request.json() as {
      scope: InsightScope;
      periodType: InsightPeriodType;
      periodStart: string;
      periodEnd: string;
      model?: string;
      regenerate?: boolean;
    };

    const { scope, periodType, periodStart, periodEnd, model, regenerate } = body;

    // Validate
    if (!scope || !periodType || !periodStart || !periodEnd) {
      return errorResponse('Missing required fields: scope, periodType, periodStart, periodEnd', 400);
    }
    if (!['user', 'team'].includes(scope)) {
      return errorResponse('scope must be "user" or "team"', 400);
    }
    if (!['week', 'month', 'quarter', 'year'].includes(periodType)) {
      return errorResponse('periodType must be "week", "month", "quarter", or "year"', 400);
    }

    // Team insights require admin
    if (scope === 'team') {
      const adminCheck = requireAdmin(authResult.context);
      if (!adminCheck.success) {
        return errorResponse(adminCheck.error, adminCheck.status);
      }
    }

    // Validate period hasn't ended yet (must be in the past)
    const periodEndDate = new Date(periodEnd + 'T23:59:59Z');
    if (periodEndDate >= new Date()) {
      return errorResponse('Cannot generate insights for a period that has not ended yet', 400);
    }

    const userId = scope === 'user' ? authResult.context.member.user_id : null;

    // Check if already exists (unless regenerating)
    if (!regenerate) {
      const existing = await getInsightByPeriod(db, scope, userId, periodType, periodStart);
      if (existing && existing.status === 'completed') {
        return successResponse(existing);
      }
    }

    // Mark as generating
    const insightId = crypto.randomUUID();
    await upsertInsight(db, {
      id: insightId,
      scope,
      user_id: userId,
      period_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      model_used: model || authResult.context.teamConfig.llm_model || null,
      status: 'generating',
      content: null,
      error: null,
      generated_at: null,
    });

    const scopeDetail = scope === 'user'
      ? authResult.context.member.display_name
      : authResult.context.teamConfig.team_name;

    // Compute period label
    const available = getAvailablePeriods(periodType, periodStart);
    const periodLabel = available.find(p => p.start === periodStart)?.label || `${periodStart} to ${periodEnd}`;

    const result = await runInsightGeneration(db, {
      insightId,
      scope,
      userId,
      periodType,
      periodStart,
      periodEnd,
      periodLabel,
      scopeDetail,
      model: model || null,
      encryptionKey: encryptionKey || '',
    });

    return successResponse({ id: insightId, status: result.status });
  } catch (error) {
    console.error('Insight generation error:', error);
    return errorResponse('Failed to generate insight', 500);
  }
}
