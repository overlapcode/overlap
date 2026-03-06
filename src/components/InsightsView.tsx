import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithTimeout } from '@lib/utils/fetch';

type InsightPeriodType = 'week' | 'month' | 'quarter' | 'year';
type InsightScope = 'user' | 'team';

type PeriodInfo = {
  type: InsightPeriodType;
  start: string;
  end: string;
  label: string;
};

type Insight = {
  id: string;
  scope: InsightScope;
  user_id: string | null;
  period_type: InsightPeriodType;
  period_start: string;
  period_end: string;
  model_used: string | null;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  content: string | null;
  error: string | null;
  generated_at: string | null;
};

type InsightContent = {
  stats: {
    total_sessions: number;
    total_cost_usd: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_files_touched: number;
    total_prompts: number;
    avg_session_duration_ms: number;
    total_overlaps: number;
    total_blocks: number;
    total_warns: number;
  };
  by_repo: Array<{ repo_name: string; session_count: number; file_count: number; cost: number }>;
  by_model: Array<{ model: string; session_count: number; cost: number }>;
  hottest_files: Array<{ file_path: string; repo_name: string; edit_count: number; user_count: number }>;
  tool_usage: Array<{ tool_name: string; count: number }>;
  facet_stats?: {
    total_facets: number;
    outcomes: Record<string, number>;
    session_types: Record<string, number>;
    top_goal_categories: Array<{ category: string; count: number }>;
    total_friction_events: number;
    friction_by_type: Record<string, number>;
  };
  summary: string;
  highlights: string[];
  project_areas: Array<{ name: string; session_count: number; description: string }>;
  interaction_style?: string;
  friction_analysis: Array<{ category: string; description: string; examples: string[] }>;
  accomplishments: Array<{ title: string; description: string }>;
  narrative: string;
  recommendations: Array<{ title: string; description: string }>;
  // Backward compat: old insights may have string[] recommendations
};

type ApiResponse = {
  insights: Insight[];
  available: PeriodInfo[];
  member: { user_id: string; display_name: string; role: string };
  team_name: string;
  has_llm: boolean;
  llm_provider: string | null;
};

const MODEL_OPTIONS: Record<string, string[]> = {
  anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'o3-mini'],
  xai: ['grok-4-fast-non-reasoning', 'grok-4'],
  google: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'],
};

const PERIOD_LABELS: Record<InsightPeriodType, string> = {
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Annual',
};

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

function formatCategory(cat: string): string {
  return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getInsightSessionCount(insight: { content: string | null } | null): number | null {
  if (!insight?.content) return null;
  try {
    const parsed = JSON.parse(insight.content) as { stats?: { total_sessions?: number } };
    return parsed.stats?.total_sessions ?? null;
  } catch { return null; }
}

export function InsightsView() {
  const [scope, setScope] = useState<InsightScope>('user');
  const [periodType, setPeriodType] = useState<InsightPeriodType>('week');
  const [insights, setInsights] = useState<Insight[]>([]);
  const [available, setAvailable] = useState<PeriodInfo[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [member, setMember] = useState<ApiResponse['member'] | null>(null);
  const [teamName, setTeamName] = useState('');
  const [hasLLM, setHasLLM] = useState(false);
  const [llmProvider, setLlmProvider] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasLoadedRef = useRef(false);
  const cacheRef = useRef<Record<string, { insights: Insight[]; available: PeriodInfo[] }>>({});
  const prefetchedRef = useRef(false);
  const [generatingStartedAt, setGeneratingStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Elapsed time counter while generating
  useEffect(() => {
    if (!generating || !generatingStartedAt) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - generatingStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [generating, generatingStartedAt]);

  const fetchInsights = useCallback(async () => {
    const key = `${scope}:${periodType}`;
    if (!hasLoadedRef.current && !cacheRef.current[key]) setLoading(true);
    setError(null);
    try {
      const resp = await fetchWithTimeout(
        `/api/insights?scope=${scope}&periodType=${periodType}&includeAvailable=1`
      );
      if (!resp.ok) throw new Error('Failed to fetch');
      const json = await resp.json() as { data: ApiResponse };
      const data = json.data;
      cacheRef.current[key] = { insights: data.insights, available: data.available };
      setInsights(data.insights);
      setAvailable(data.available);
      setMember(data.member);
      setTeamName(data.team_name);
      setHasLLM(data.has_llm);
      setLlmProvider(data.llm_provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load insights');
    } finally {
      setLoading(false);
      hasLoadedRef.current = true;
    }
  }, [scope, periodType]);

  useEffect(() => {
    setSelectedPeriod(null);
    const key = `${scope}:${periodType}`;
    const cached = cacheRef.current[key];
    if (cached) {
      setInsights(cached.insights);
      setAvailable(cached.available);
    }
    fetchInsights().then(() => {
      // Prefetch other period types in background so tab switching is instant
      if (!prefetchedRef.current) {
        prefetchedRef.current = true;
        const otherTypes = (['week', 'month', 'quarter', 'year'] as InsightPeriodType[])
          .filter(t => t !== periodType);
        for (const t of otherTypes) {
          const otherKey = `${scope}:${t}`;
          if (!cacheRef.current[otherKey]) {
            fetchWithTimeout(`/api/insights?scope=${scope}&periodType=${t}&includeAvailable=1`)
              .then(r => r.ok ? r.json() as Promise<{ data: ApiResponse }> : null)
              .then(json => { if (json) cacheRef.current[otherKey] = { insights: json.data.insights, available: json.data.available }; })
              .catch(() => {});
          }
        }
      }
    });
  }, [scope, periodType, fetchInsights]);

  const startPolling = useCallback((periodStart: string, currentPeriodType: InsightPeriodType, currentScope: InsightScope) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetchWithTimeout(
          `/api/insights?scope=${currentScope}&periodType=${currentPeriodType}&includeAvailable=1`
        );
        if (!resp.ok) return;
        const json = await resp.json() as { data: ApiResponse };
        const data = json.data;
        setInsights(data.insights);
        setAvailable(data.available);

        const match = data.insights.find(i => i.period_start === periodStart && i.period_type === currentPeriodType);
        if (match && match.status !== 'generating') {
          // Done — stop polling
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setGenerating(false);
          setGeneratingStartedAt(null);
          setSelectedPeriod(periodStart);
          if (match.status === 'failed') {
            setError(match.error || 'Generation failed');
          }
        }
      } catch {
        // Ignore poll errors, will retry on next interval
      }
    }, 3000);
  }, []);

  const handleGenerate = async (period: PeriodInfo, regenerate = false) => {
    setGenerating(true);
    setGeneratingStartedAt(Date.now());
    setError(null);
    try {
      const resp = await fetchWithTimeout('/api/insights/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          periodType: period.type,
          periodStart: period.start,
          periodEnd: period.end,
          model: selectedModel || undefined,
          regenerate,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json() as { error: string };
        throw new Error(err.error || 'Generation failed');
      }
      // Response returns immediately — poll for completion
      startPolling(period.start, period.type, scope);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
      setGenerating(false);
      setGeneratingStartedAt(null);
    }
  };

  const handleGenerateAll = async () => {
    setGenerating(true);
    setGeneratingStartedAt(Date.now());
    setError(null);
    const ungenerated = getUngeneratedPeriods();
    try {
      // Fire all generation requests (they return immediately now)
      for (const period of ungenerated) {
        const resp = await fetchWithTimeout('/api/insights/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope,
            periodType: period.type,
            periodStart: period.start,
            periodEnd: period.end,
            model: selectedModel || undefined,
          }),
        });
        if (!resp.ok) {
          const err = await resp.json() as { error: string };
          console.error(`Failed to generate ${period.label}:`, err.error);
        }
      }
      // Poll until all are done
      if (pollRef.current) clearInterval(pollRef.current);
      const expectedStarts = new Set(ungenerated.map(p => p.start));
      pollRef.current = setInterval(async () => {
        try {
          const resp = await fetchWithTimeout(
            `/api/insights?scope=${scope}&periodType=${periodType}&includeAvailable=1`
          );
          if (!resp.ok) return;
          const json = await resp.json() as { data: ApiResponse };
          setInsights(json.data.insights);
          setAvailable(json.data.available);

          const allDone = [...expectedStarts].every(start => {
            const match = json.data.insights.find(i => i.period_start === start && i.period_type === periodType);
            return match && match.status !== 'generating';
          });
          if (allDone) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setGenerating(false);
            setGeneratingStartedAt(null);
          }
        } catch {
          // Ignore poll errors
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch generation failed');
      setGenerating(false);
      setGeneratingStartedAt(null);
    }
  };

  const getUngeneratedPeriods = (): PeriodInfo[] => {
    const generatedStarts = new Set(
      insights.filter(i => i.period_type === periodType).map(i => i.period_start)
    );
    return available
      .filter(p => p.type === periodType && !generatedStarts.has(p.start))
      .sort((a, b) => b.start.localeCompare(a.start));
  };

  // Use cached data during tab transitions to prevent flash
  const cacheKey = `${scope}:${periodType}`;
  const cachedData = cacheRef.current[cacheKey];
  const displayInsights = cachedData?.insights ?? insights;
  const displayAvailable = cachedData?.available ?? available;

  const generatedForType = displayInsights
    .filter(i => i.period_type === periodType)
    .sort((a, b) => b.period_start.localeCompare(a.period_start));

  const ungeneratedPeriods = (() => {
    const generatedStarts = new Set(generatedForType.map(i => i.period_start));
    return displayAvailable
      .filter(p => p.type === periodType && !generatedStarts.has(p.start))
      .sort((a, b) => b.start.localeCompare(a.start));
  })();

  const allPeriods = [
    ...generatedForType.map(i => ({
      start: i.period_start,
      end: i.period_end,
      label: displayAvailable.find(a => a.start === i.period_start)?.label || `${i.period_start} to ${i.period_end}`,
      insight: i,
      generated: true,
    })),
    ...ungeneratedPeriods.map(p => ({
      start: p.start,
      end: p.end,
      label: p.label,
      insight: null as Insight | null,
      generated: false,
    })),
  ].sort((a, b) => b.start.localeCompare(a.start));

  const periodListItems = (() => {
    type Item = { kind: 'header'; month: string } | { kind: 'period'; data: (typeof allPeriods)[number] };
    if (periodType !== 'week') {
      return allPeriods.map(p => ({ kind: 'period' as const, data: p }));
    }
    const items: Item[] = [];
    let currentMonth = '';
    for (const p of allPeriods) {
      const d = new Date(p.start + 'T00:00:00Z');
      const month = d.toLocaleString('en', { month: 'long', timeZone: 'UTC' }) + ' ' + d.getUTCFullYear();
      if (month !== currentMonth) {
        currentMonth = month;
        items.push({ kind: 'header', month });
      }
      items.push({ kind: 'period', data: p });
    }
    return items;
  })();

  const selectedInsight = selectedPeriod
    ? generatedForType.find(i => i.period_start === selectedPeriod) ?? null
    : generatedForType[0] ?? null;

  const parsedContent: InsightContent | null = selectedInsight?.content
    ? (() => { try { return JSON.parse(selectedInsight.content) as InsightContent; } catch { return null; } })()
    : null;

  const isAdmin = member?.role === 'admin';
  const canGenerateTeam = scope === 'team' ? isAdmin : true;
  const modelOptions = llmProvider ? MODEL_OPTIONS[llmProvider] || [] : [];

  // Current selected period label for dropdown trigger
  const currentPeriodLabel = selectedInsight
    ? allPeriods.find(p => p.start === selectedInsight.period_start)?.label || selectedInsight.period_start
    : allPeriods[0]?.label || 'Select period';

  return (
    <div className="insights-container">
      {/* Header */}
      <div className="insights-header">
        <h1>Insights</h1>
        <div className="insights-controls">
          <div className="scope-toggle">
            <button className={`scope-btn ${scope === 'user' ? 'active' : ''}`} onClick={() => { setScope('user'); prefetchedRef.current = false; }}>
              My Insights
            </button>
            <button className={`scope-btn ${scope === 'team' ? 'active' : ''}`} onClick={() => { setScope('team'); prefetchedRef.current = false; }}>
              Team Insights
            </button>
          </div>
          {hasLLM && modelOptions.length > 0 && (
            <select className="model-picker" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              <option value="">Default model</option>
              {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Period type tabs + period selector */}
      <div className="period-toolbar">
        <div className="period-tabs">
          {(['week', 'month', 'quarter', 'year'] as InsightPeriodType[]).map((t) => (
            <button key={t} className={`period-tab ${periodType === t ? 'active' : ''}`} onClick={() => setPeriodType(t)}>
              {PERIOD_LABELS[t]}
            </button>
          ))}
        </div>

        {!loading && (
          <div className="period-selector-row">
            <div className="period-dropdown-wrap" ref={dropdownRef}>
              <button className="period-dropdown-trigger" onClick={() => setDropdownOpen(o => !o)}>
                <span className="period-dropdown-label">{currentPeriodLabel}</span>
                <span className="period-dropdown-arrow">{dropdownOpen ? '\u25B4' : '\u25BE'}</span>
              </button>

              {dropdownOpen && (
                <div className="period-dropdown-menu">
                  {periodListItems.length === 0 && (
                    <div className="dropdown-empty">No completed periods yet.</div>
                  )}
                  {periodListItems.map((item) => {
                    if (item.kind === 'header') {
                      return <div key={item.month} className="dropdown-month-header">{item.month}</div>;
                    }
                    const p = item.data;
                    const isSelected = selectedPeriod === p.start || (!selectedPeriod && p.insight?.id === selectedInsight?.id);
                    const sessionCount = getInsightSessionCount(p.insight);
                    return (
                      <div
                        key={p.start}
                        className={`dropdown-item ${isSelected ? 'selected' : ''} ${p.generated ? 'generated' : 'ungenerated'} ${p.insight?.status === 'failed' ? 'failed' : ''}`}
                        onClick={() => {
                          if (p.generated || p.insight?.status === 'generating') {
                            setSelectedPeriod(p.start);
                            setDropdownOpen(false);
                          }
                        }}
                      >
                        <span className="dropdown-item-label">{p.label}</span>
                        <span className="dropdown-item-meta">
                          {p.insight?.status === 'generating' ? (
                            <span className="status-badge generating">Generating{elapsedSeconds > 0 ? ` ${elapsedSeconds}s` : '...'}</span>
                          ) : p.insight?.status === 'failed' ? (
                            <span className="status-badge failed">Failed</span>
                          ) : p.generated && sessionCount !== null ? (
                            <span className="dropdown-session-count">{sessionCount}s</span>
                          ) : !p.generated && canGenerateTeam ? (
                            <button
                              className="btn-generate-inline"
                              onClick={(e) => { e.stopPropagation(); handleGenerate({ type: periodType, start: p.start, end: p.end, label: p.label }); setDropdownOpen(false); }}
                              disabled={generating}
                            >
                              Generate
                            </button>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                  {scope === 'team' && !isAdmin && ungeneratedPeriods.length > 0 && (
                    <div className="dropdown-note">Only admins can generate team insights.</div>
                  )}
                </div>
              )}
            </div>

            {canGenerateTeam && ungeneratedPeriods.length > 0 && (
              <button className="btn-generate-all" onClick={handleGenerateAll} disabled={generating}>
                {generating ? `Generating${elapsedSeconds > 0 ? ` (${elapsedSeconds}s)` : '...'}` : `Generate All (${ungeneratedPeriods.length})`}
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className="insights-error">{error}</div>}

      {loading ? (
        <div className="insights-loading">Loading insights...</div>
      ) : (
        <div className="insight-detail">
          {!selectedInsight ? (
            <div className="no-insight-selected">
              <p>No insights generated yet for {PERIOD_LABELS[periodType].toLowerCase()} periods.</p>
              {canGenerateTeam && ungeneratedPeriods.length > 0 && (
                <p>Select a period from the dropdown and click Generate.</p>
              )}
            </div>
          ) : selectedInsight.status === 'generating' ? (
            <div className="no-insight-selected generating-state">
              <div className="generating-spinner" />
              <p>Generating insight{elapsedSeconds > 0 ? ` (${elapsedSeconds}s)` : ''}...</p>
              <p className="generating-sub">
                {elapsedSeconds < 30
                  ? 'Analyzing sessions, generating facets, and synthesizing your report.'
                  : elapsedSeconds < 90
                    ? 'Still working — this typically takes 30-90 seconds for large periods.'
                    : 'Taking longer than usual — the LLM may be processing a large volume of data.'}
              </p>
            </div>
          ) : selectedInsight.status === 'failed' ? (
            <div className="no-insight-selected failed-state">
              <div className="failed-icon">!</div>
              <p>Generation failed</p>
              <p className="generating-sub">{selectedInsight.error || 'An unknown error occurred during generation.'}</p>
              {canGenerateTeam && (
                <button
                  className="btn-regenerate"
                  onClick={() => {
                    const period = allPeriods.find(p => p.start === selectedInsight.period_start);
                    if (period) handleGenerate({ type: periodType, start: period.start, end: period.end, label: period.label }, true);
                  }}
                  disabled={generating}
                >
                  {generating ? 'Regenerating...' : 'Try Again'}
                </button>
              )}
            </div>
          ) : parsedContent ? (
            <InsightReport
              content={parsedContent}
              insight={selectedInsight}
              periodLabel={allPeriods.find(p => p.start === selectedInsight.period_start)?.label || ''}
              onRegenerate={() => {
                const period = allPeriods.find(p => p.start === selectedInsight.period_start);
                if (period) handleGenerate({ type: periodType, start: period.start, end: period.end, label: period.label }, true);
              }}
              canRegenerate={canGenerateTeam}
              generating={generating}
            />
          ) : (
            <div className="no-insight-selected">
              <p>Insight data could not be parsed.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Insight Report ──────────────────────────────────────────────────────

type InsightReportProps = {
  content: InsightContent;
  insight: Insight;
  periodLabel: string;
  onRegenerate: () => void;
  canRegenerate: boolean;
  generating: boolean;
};

function InsightReport({ content, insight, periodLabel, onRegenerate, canRegenerate, generating }: InsightReportProps) {
  const s = content.stats;

  // Normalize recommendations (backward compat: may be string[] or {title,description}[])
  const recommendations = (content.recommendations || []).map(r =>
    typeof r === 'string' ? { title: r, description: '' } : r
  );

  return (
    <div className="insight-report">
      {/* Report header */}
      <div className="report-header">
        <div>
          <h2>{periodLabel}</h2>
          <div className="report-meta">
            {insight.model_used && <span>Model: {insight.model_used}</span>}
            {insight.generated_at && <span>Generated {new Date(insight.generated_at).toLocaleDateString()}</span>}
          </div>
        </div>
        {canRegenerate && (
          <button className="btn-regenerate" onClick={onRegenerate} disabled={generating}>
            {generating ? 'Regenerating...' : 'Regenerate'}
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="report-summary">{content.summary}</div>

      {/* Key stats */}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{s.total_sessions}</div><div className="stat-label">Sessions</div></div>
        <div className="stat-card"><div className="stat-value">{formatCost(s.total_cost_usd)}</div><div className="stat-label">Cost</div></div>
        <div className="stat-card"><div className="stat-value">{s.total_files_touched}</div><div className="stat-label">Files Touched</div></div>
        <div className="stat-card"><div className="stat-value">{s.total_prompts}</div><div className="stat-label">Prompts</div></div>
        <div className="stat-card"><div className="stat-value">{formatDuration(s.avg_session_duration_ms)}</div><div className="stat-label">Avg Session</div></div>
        <div className="stat-card"><div className="stat-value">{formatTokens(s.total_input_tokens + s.total_output_tokens)}</div><div className="stat-label">Total Tokens</div></div>
        {s.total_overlaps > 0 && (
          <>
            <div className="stat-card overlap-stat"><div className="stat-value">{s.total_overlaps}</div><div className="stat-label">Overlaps</div></div>
            <div className="stat-card block-stat"><div className="stat-value">{s.total_blocks}</div><div className="stat-label">Blocked</div></div>
          </>
        )}
      </div>

      {/* Highlights */}
      {content.highlights.length > 0 && (
        <div className="report-section">
          <h3>Highlights</h3>
          <ul className="highlights-list">
            {content.highlights.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </div>
      )}

      {/* Facet-derived outcome & session type distribution */}
      {content.facet_stats && content.facet_stats.total_facets > 0 && (
        <div className="report-section">
          <h3>Session Analysis</h3>
          <div className="facet-grid">
            <div className="facet-card">
              <h4>Outcomes</h4>
              <div className="outcome-bars">
                {Object.entries(content.facet_stats.outcomes)
                  .sort((a, b) => b[1] - a[1])
                  .map(([outcome, count]) => (
                    <div key={outcome} className="outcome-row">
                      <span className={`outcome-label outcome-${outcome}`}>{formatCategory(outcome)}</span>
                      <div className="outcome-bar-track">
                        <div className={`outcome-bar-fill outcome-fill-${outcome}`} style={{ width: `${(count / content.facet_stats!.total_facets) * 100}%` }} />
                      </div>
                      <span className="outcome-count">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
            <div className="facet-card">
              <h4>Session Types</h4>
              <div className="type-pills">
                {Object.entries(content.facet_stats.session_types)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <span key={type} className="type-pill">{formatCategory(type)} <strong>{count}</strong></span>
                  ))}
              </div>
              {content.facet_stats.top_goal_categories.length > 0 && (
                <>
                  <h4 style={{ marginTop: '1rem' }}>Top Work Categories</h4>
                  <div className="type-pills">
                    {content.facet_stats.top_goal_categories.slice(0, 6).map(g => (
                      <span key={g.category} className="type-pill category-pill">{formatCategory(g.category)} <strong>{g.count}</strong></span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Project Areas */}
      {content.project_areas && content.project_areas.length > 0 && (
        <div className="report-section">
          <h3>What You Worked On</h3>
          <div className="project-areas">
            {content.project_areas.map((area, i) => (
              <div key={i} className="project-area-card">
                <div className="project-area-header">
                  <span className="project-area-name">{area.name}</span>
                  <span className="project-area-count">{area.session_count} session{area.session_count !== 1 ? 's' : ''}</span>
                </div>
                <p className="project-area-desc">{area.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interaction Style */}
      {content.interaction_style && (
        <div className="report-section">
          <h3>How You Use the Agent</h3>
          <div className="narrative-text">
            {content.interaction_style.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </div>
      )}

      {/* Narrative */}
      {content.narrative && (
        <div className="report-section">
          <h3>Analysis</h3>
          <div className="narrative-text">
            {content.narrative.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </div>
      )}

      {/* Accomplishments */}
      {content.accomplishments && content.accomplishments.length > 0 && (
        <div className="report-section accomplishments-section">
          <h3>Accomplishments</h3>
          <div className="accomplishments-list">
            {content.accomplishments.map((a, i) => (
              <div key={i} className="accomplishment-card">
                <div className="accomplishment-title">{a.title}</div>
                <p className="accomplishment-desc">{a.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Friction Analysis */}
      {content.friction_analysis && content.friction_analysis.length > 0 && (
        <div className="report-section friction-section">
          <h3>Where Things Went Wrong</h3>
          <div className="friction-list">
            {content.friction_analysis.map((f, i) => (
              <div key={i} className="friction-card">
                <div className="friction-category">{f.category}</div>
                <p className="friction-desc">{f.description}</p>
                {f.examples.length > 0 && (
                  <ul className="friction-examples">
                    {f.examples.map((ex, j) => <li key={j}>{ex}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Repos breakdown */}
      {content.by_repo.length > 0 && (
        <div className="report-section">
          <h3>Repositories</h3>
          <div className="breakdown-table">
            <div className="breakdown-header">
              <span>Repo</span><span>Sessions</span><span>Files</span><span>Cost</span>
            </div>
            {content.by_repo.map((r) => (
              <div key={r.repo_name} className="breakdown-row">
                <span className="repo-name">{r.repo_name}</span>
                <span>{r.session_count}</span>
                <span>{r.file_count}</span>
                <span>{formatCost(r.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tool usage */}
      {content.tool_usage.length > 0 && (
        <div className="report-section">
          <h3>Tool Usage</h3>
          <div className="bar-chart">
            {content.tool_usage.slice(0, 8).map((t) => {
              const maxCount = content.tool_usage[0]?.count || 1;
              return (
                <div key={t.tool_name} className="bar-row">
                  <span className="bar-label">{t.tool_name}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(t.count / maxCount) * 100}%` }} />
                  </div>
                  <span className="bar-value">{t.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Hottest files */}
      {content.hottest_files.length > 0 && (
        <div className="report-section">
          <h3>Most Active Files</h3>
          <div className="breakdown-table">
            <div className="breakdown-header">
              <span>File</span><span>Edits</span><span>Users</span>
            </div>
            {content.hottest_files.slice(0, 8).map((f) => (
              <div key={`${f.repo_name}:${f.file_path}`} className="breakdown-row">
                <span className="file-path" title={f.file_path}>
                  {f.file_path.split('/').pop()}
                  <span className="file-repo">{f.repo_name}</span>
                </span>
                <span>{f.edit_count}</span>
                <span>{f.user_count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Models */}
      {content.by_model.length > 0 && (
        <div className="report-section">
          <h3>Models Used</h3>
          <div className="breakdown-table">
            <div className="breakdown-header">
              <span>Model</span><span>Sessions</span><span>Cost</span>
            </div>
            {content.by_model.map((m) => (
              <div key={m.model} className="breakdown-row">
                <span>{m.model}</span>
                <span>{m.session_count}</span>
                <span>{formatCost(m.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="report-section recommendations-section">
          <h3>Recommendations</h3>
          <div className="recommendations-list">
            {recommendations.map((r, i) => (
              <div key={i} className="recommendation-card">
                <div className="recommendation-title">{r.title}</div>
                {r.description && <p className="recommendation-desc">{r.description}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
