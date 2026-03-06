/**
 * POST /api/insights/generate - Generate insight for a specific period
 *
 * Two-layer pipeline:
 *   Layer 1: Generate per-session facets (if not already cached)
 *   Layer 2: Aggregate facets + stats, synthesize rich narrative report
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
import { getInsightByPeriod, upsertInsight, getTeamConfig, getSessionFacetsForPeriod } from '@lib/db/queries';
import { aggregateInsightData, generateSessionFacets, generateInsightNarrative, getAvailablePeriods } from '@lib/insights';
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

    // Capture values needed for background work
    const scopeDetail = scope === 'user'
      ? authResult.context.member.display_name
      : authResult.context.teamConfig.team_name;
    const teamLlmModel = authResult.context.teamConfig.llm_model;

    // Run generation in the background via waitUntil — response returns immediately
    const backgroundWork = (async () => {
      const t0 = Date.now();
      const log = (stage: string, detail?: string) =>
        console.log(`[insight:${insightId.slice(0, 8)}] ${stage}${detail ? ` — ${detail}` : ''} (+${Date.now() - t0}ms)`);

      try {
        // Aggregate quantitative data
        log('start', `scope=${scope} period=${periodStart}..${periodEnd} model=${model || 'default'}`);
        const aggregated = await aggregateInsightData(db, scope, userId, periodStart, periodEnd);
        log('aggregated', `${aggregated.stats.total_sessions} sessions, ${aggregated.stats.total_files_touched} files`);

        if (aggregated.stats.total_sessions === 0) {
          await upsertInsight(db, {
            id: insightId,
            scope,
            user_id: userId,
            period_type: periodType,
            period_start: periodStart,
            period_end: periodEnd,
            model_used: null,
            status: 'completed',
            content: JSON.stringify({
              ...aggregated,
              summary: 'No sessions recorded during this period.',
              highlights: ['No activity recorded'],
              project_areas: [],
              friction_analysis: [],
              accomplishments: [],
              narrative: 'There were no coding agent sessions during this period.',
              recommendations: [],
            }),
            error: null,
            generated_at: new Date().toISOString(),
          });
          log('complete', 'no sessions — saved empty insight');
          return;
        }

        // Layer 1: Generate per-session facets (cached — only generates for sessions without facets)
        log('facets:start');
        const teamConfig = await getTeamConfig(db);
        try {
          const facetResult = await generateSessionFacets(db, scope, userId, periodStart, periodEnd, teamConfig!, encryptionKey || '', model);
          log('facets:done', `generated=${facetResult.generated} total=${facetResult.total}`);
        } catch (facetErr) {
          log('facets:error', facetErr instanceof Error ? facetErr.message : String(facetErr));
          console.error('Facet generation error (continuing with available facets):', facetErr);
        }

        // Fetch all facets for this period (including previously generated ones)
        const facets = await getSessionFacetsForPeriod(db, userId, periodStart, periodEnd);
        log('facets:fetched', `${facets.length} facets for narrative`);

        // Layer 2: Synthesize narrative from facets + stats
        const available = getAvailablePeriods(periodType, periodStart);
        const periodLabel = available.find(p => p.start === periodStart)?.label || `${periodStart} to ${periodEnd}`;

        log('narrative:start');
        let synthesis;
        try {
          synthesis = await generateInsightNarrative(
            aggregated,
            facets,
            scope,
            scopeDetail,
            periodLabel,
            periodStart,
            periodEnd,
            teamConfig!,
            encryptionKey || '',
            model,
          );
          log('narrative:done');
        } catch (llmError) {
          const errMsg = llmError instanceof Error ? llmError.message : String(llmError);
          log('narrative:error', errMsg);
          console.error('LLM insight synthesis error:', llmError);
          synthesis = {
            summary: `${aggregated.stats.total_sessions} sessions during ${periodLabel}. (LLM analysis failed)`,
            highlights: [`${aggregated.stats.total_sessions} sessions`, `${aggregated.stats.total_files_touched} files touched`],
            project_areas: [],
            friction_analysis: [],
            accomplishments: [],
            narrative: 'LLM analysis unavailable — the report shows stats only. Check your API key in Settings.',
            recommendations: [{ title: 'LLM Error', description: errMsg }],
            llm_error: errMsg,
          };
        }

        const content = { ...aggregated, ...synthesis };
        log('saving');

        await upsertInsight(db, {
          id: insightId,
          scope,
          user_id: userId,
          period_type: periodType,
          period_start: periodStart,
          period_end: periodEnd,
          model_used: model || teamLlmModel || null,
          status: 'completed',
          content: JSON.stringify(content),
          error: null,
          generated_at: new Date().toISOString(),
        });
        log('complete', `total ${Date.now() - t0}ms`);
      } catch (bgError) {
        log('FAILED', bgError instanceof Error ? bgError.message : String(bgError));
        console.error('Background insight generation error:', bgError);
        await upsertInsight(db, {
          id: insightId,
          scope,
          user_id: userId,
          period_type: periodType,
          period_start: periodStart,
          period_end: periodEnd,
          model_used: model || teamLlmModel || null,
          status: 'failed',
          content: null,
          error: bgError instanceof Error ? bgError.message : 'Generation failed',
          generated_at: null,
        });
      }
    })();

    context.locals.runtime.ctx.waitUntil(backgroundWork);

    // Return immediately with the generating status
    return successResponse({ id: insightId, status: 'generating' });
  } catch (error) {
    console.error('Insight generation error:', error);
    return errorResponse('Failed to generate insight', 500);
  }
}
