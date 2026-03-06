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
        const key = `${currentScope}:${currentPeriodType}`;
        cacheRef.current[key] = { insights: data.insights, available: data.available };
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
          const key = `${scope}:${periodType}`;
          cacheRef.current[key] = { insights: json.data.insights, available: json.data.available };
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

// ── Export Helpers ──────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function contentToPrintHTML(content: InsightContent, periodLabel: string, insight: Insight): string {
  const s = content.stats;
  const recs = (content.recommendations || []).map(r =>
    typeof r === 'string' ? { title: r, description: '' } : r
  );
  const generatedDate = insight.generated_at ? new Date(insight.generated_at).toLocaleDateString() : '';
  const logoUrl = `${window.location.origin}/logo.png`;

  const section = (title: string, body: string) =>
    `<div class="section"><h2>${esc(title)}</h2>${body}</div>`;

  const accentSection = (title: string, body: string, accent: string) =>
    `<div class="section accent-section" style="background:${accent}10;border:1px solid ${accent}25;border-radius:8px;padding:20px 24px;">`
    + `<h2 style="color:${accent}">${esc(title)}</h2>${body}</div>`;

  // Build stats cards
  const statItems = [
    ['Sessions', String(s.total_sessions)],
    ['Cost', formatCost(s.total_cost_usd)],
    ['Files Touched', String(s.total_files_touched)],
    ['Prompts', String(s.total_prompts)],
    ['Avg Session', formatDuration(s.avg_session_duration_ms)],
    ['Total Tokens', formatTokens(s.total_input_tokens + s.total_output_tokens)],
    ...(s.total_overlaps > 0 ? [['Overlaps', String(s.total_overlaps)], ['Blocked', String(s.total_blocks)]] : []),
  ];
  const statsHTML = `<div class="stats-grid">${statItems.map(([label, value]) =>
    `<div class="stat"><div class="stat-val">${esc(value as string)}</div><div class="stat-lbl">${esc(label as string)}</div></div>`
  ).join('')}</div>`;

  // Highlights
  const highlightsHTML = content.highlights?.length
    ? section('Highlights', `<ul>${content.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>`)
    : '';

  // Session analysis
  let sessionAnalysisHTML = '';
  if (content.facet_stats && content.facet_stats.total_facets > 0) {
    const fs = content.facet_stats;
    let inner = '';
    if (Object.keys(fs.outcomes).length) {
      inner += '<div class="analysis-col"><h3>Outcomes</h3>';
      const sorted = Object.entries(fs.outcomes).sort((a, b) => b[1] - a[1]);
      sorted.forEach(([outcome, count]) => {
        const pct = (count / fs.total_facets) * 100;
        const color = outcome === 'fully_achieved' ? '#8a9e6d' : outcome === 'mostly_achieved' ? '#8abe6f'
          : outcome === 'partially_achieved' ? '#d4a843' : '#d97757';
        inner += `<div class="bar-row"><span class="bar-lbl">${esc(formatCategory(outcome))}</span>`
          + `<div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>`
          + `<span class="bar-ct">${count}</span></div>`;
      });
      inner += '</div>';
    }
    if (Object.keys(fs.session_types).length) {
      inner += '<div class="analysis-col"><h3>Session Types</h3><div class="pills">';
      Object.entries(fs.session_types).sort((a, b) => b[1] - a[1])
        .forEach(([t, c]) => { inner += `<span class="pill">${esc(formatCategory(t))} <strong>${c}</strong></span>`; });
      inner += '</div>';
      if (fs.top_goal_categories?.length) {
        inner += '<h3 style="margin-top:12px">Top Categories</h3><div class="pills">';
        fs.top_goal_categories.slice(0, 6).forEach(g => {
          inner += `<span class="pill cat">${esc(formatCategory(g.category))} <strong>${g.count}</strong></span>`;
        });
        inner += '</div>';
      }
      inner += '</div>';
    }
    sessionAnalysisHTML = section('Session Analysis', `<div class="analysis-grid">${inner}</div>`);
  }

  // Project areas
  const areasHTML = content.project_areas?.length
    ? section('What You Worked On', content.project_areas.map(a =>
      `<div class="card"><div class="card-hdr"><span class="card-title">${esc(a.name)}</span>`
      + `<span class="card-badge">${a.session_count} session${a.session_count !== 1 ? 's' : ''}</span></div>`
      + `<p>${esc(a.description)}</p></div>`
    ).join(''))
    : '';

  // Interaction style
  const styleHTML = content.interaction_style
    ? section('How You Use the Agent', content.interaction_style.split('\n\n').map(p => `<p>${esc(p)}</p>`).join(''))
    : '';

  // Narrative
  const narrativeHTML = content.narrative
    ? section('Analysis', content.narrative.split('\n\n').map(p => `<p>${esc(p)}</p>`).join(''))
    : '';

  // Accomplishments
  const accomplishmentsHTML = content.accomplishments?.length
    ? accentSection('Accomplishments', content.accomplishments.map(a =>
      `<div class="item"><div class="item-title" style="color:#8a9e6d">${esc(a.title)}</div><p>${esc(a.description)}</p></div>`
    ).join(''), '#8a9e6d')
    : '';

  // Friction
  const frictionHTML = content.friction_analysis?.length
    ? accentSection('Where Things Went Wrong', content.friction_analysis.map(f =>
      `<div class="item"><div class="item-title" style="color:#d97757">${esc(f.category)}</div>`
      + `<p>${esc(f.description)}</p>`
      + (f.examples?.length ? `<ul class="examples">${f.examples.map(ex => `<li>${esc(ex)}</li>`).join('')}</ul>` : '')
      + '</div>'
    ).join(''), '#d97757')
    : '';

  // Tables
  const makeTable = (title: string, headers: string[], rows: string[][]) => {
    if (!rows.length) return '';
    return section(title,
      `<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>`
      + `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    );
  };

  const reposTable = makeTable('Repositories', ['Repo', 'Sessions', 'Files', 'Cost'],
    content.by_repo.map(r => [r.repo_name, String(r.session_count), String(r.file_count), formatCost(r.cost)]));

  // Tool usage as bar chart
  let toolHTML = '';
  if (content.tool_usage?.length) {
    const max = content.tool_usage[0]?.count || 1;
    toolHTML = section('Tool Usage', `<div class="tool-bars">${content.tool_usage.slice(0, 8).map(t =>
      `<div class="bar-row"><span class="bar-lbl">${esc(t.tool_name)}</span>`
      + `<div class="bar-track"><div class="bar-fill" style="width:${(t.count / max) * 100}%;background:#6b9edd"></div></div>`
      + `<span class="bar-ct">${t.count}</span></div>`
    ).join('')}</div>`);
  }

  const filesTable = makeTable('Most Active Files', ['File', 'Repo', 'Edits', 'Users'],
    content.hottest_files.slice(0, 8).map(f => [f.file_path, f.repo_name, String(f.edit_count), String(f.user_count)]));

  const modelsTable = makeTable('Models Used', ['Model', 'Sessions', 'Cost'],
    content.by_model.map(m => [m.model, String(m.session_count), formatCost(m.cost)]));

  const recsHTML = recs.length
    ? accentSection('Recommendations', recs.map(r =>
      `<div class="item"><div class="item-title" style="color:#8a9e6d">${esc(r.title)}</div>`
      + (r.description ? `<p>${esc(r.description)}</p>` : '') + '</div>'
    ).join(''), '#8a9e6d')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(periodLabel)} — Overlap Insight Report</title>
<style>
  @page { margin: 16mm 14mm; size: A4; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; line-height: 1.6; padding: 0; background: #fff; font-size: 13px; }
  .page { max-width: 720px; margin: 0 auto; padding: 0 20px; }
  .header { display: flex; align-items: center; gap: 10px; padding-bottom: 16px; border-bottom: 2px solid #1a1a2e; margin-bottom: 24px; }
  .header img { width: 28px; height: 28px; }
  .header-brand { font-size: 1.3rem; font-weight: 700; letter-spacing: 0.04em; color: #1a1a2e; text-decoration: none; }
  .header-right { margin-left: auto; text-align: right; font-size: 0.75rem; color: #666; }
  .period-title { font-size: 1.5rem; font-weight: 700; color: #1a1a2e; margin-bottom: 4px; }
  .summary { font-size: 0.95rem; color: #444; margin-bottom: 24px; line-height: 1.7; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 28px; }
  .stat { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 10px; text-align: center; }
  .stat-val { font-size: 1.2rem; font-weight: 700; color: #1a1a2e; font-family: 'SF Mono', 'Consolas', monospace; }
  .stat-lbl { font-size: 0.65rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
  .section { margin-bottom: 24px; break-inside: avoid; }
  .section h2 { font-size: 1rem; font-weight: 700; color: #1a1a2e; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  .section h3 { font-size: 0.85rem; font-weight: 600; color: #555; margin-bottom: 6px; }
  .section p { font-size: 0.85rem; color: #444; line-height: 1.7; margin-bottom: 8px; }
  .section ul { padding-left: 18px; margin-bottom: 8px; }
  .section li { font-size: 0.85rem; color: #444; margin-bottom: 4px; line-height: 1.6; }
  .accent-section { margin-bottom: 24px; break-inside: avoid; }
  .accent-section h2 { border-bottom: none; padding-bottom: 0; }
  .analysis-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .analysis-col { min-width: 0; }
  .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
  .bar-lbl { font-size: 0.75rem; color: #555; min-width: 110px; font-family: 'SF Mono', 'Consolas', monospace; }
  .bar-track { flex: 1; height: 6px; background: #eee; border-radius: 3px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 3px; }
  .bar-ct { font-size: 0.72rem; color: #888; min-width: 24px; text-align: right; font-family: 'SF Mono', 'Consolas', monospace; }
  .pills { display: flex; flex-wrap: wrap; gap: 5px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: #f0f1f3; border: 1px solid #e0e2e6; border-radius: 4px; font-size: 0.72rem; color: #555; font-family: 'SF Mono', 'Consolas', monospace; }
  .pill strong { color: #6b9edd; }
  .pill.cat strong { color: #d4a843; }
  .card { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; margin-bottom: 8px; }
  .card-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .card-title { font-weight: 600; font-size: 0.85rem; color: #1a1a2e; font-family: 'SF Mono', 'Consolas', monospace; }
  .card-badge { font-size: 0.72rem; color: #888; background: #eee; padding: 1px 8px; border-radius: 4px; font-family: 'SF Mono', 'Consolas', monospace; }
  .card p { font-size: 0.82rem; color: #555; margin: 0; }
  .item { padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.06); }
  .item:last-child { border-bottom: none; padding-bottom: 0; }
  .item-title { font-weight: 600; font-size: 0.85rem; margin-bottom: 3px; font-family: 'SF Mono', 'Consolas', monospace; }
  .item p { font-size: 0.82rem; color: #555; margin: 0; }
  .examples { margin-top: 6px; }
  .examples li { font-size: 0.78rem; color: #777; font-style: italic; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th { text-align: left; padding: 6px 10px; background: #f7f8fa; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #555; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
  td { padding: 6px 10px; border-bottom: 1px solid #f0f1f3; color: #444; }
  tr:last-child td { border-bottom: none; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 0.75rem; color: #999; }
  .footer a { color: #6b9edd; text-decoration: none; }
  @media print {
    body { padding: 0; }
    .page { max-width: none; padding: 0; }
    .section, .accent-section { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <img src="${logoUrl}" alt="overlap" />
    <a href="https://overlap.dev" class="header-brand">overlap</a>
    <div class="header-right">
      ${insight.model_used ? `Model: ${esc(insight.model_used)}<br>` : ''}
      ${generatedDate ? `Generated ${esc(generatedDate)}` : ''}
    </div>
  </div>
  <div class="period-title">${esc(periodLabel)}</div>
  <div class="summary">${esc(content.summary || '')}</div>
  ${statsHTML}
  ${highlightsHTML}
  ${sessionAnalysisHTML}
  ${areasHTML}
  ${styleHTML}
  ${narrativeHTML}
  ${accomplishmentsHTML}
  ${frictionHTML}
  ${reposTable}
  ${toolHTML}
  ${filesTable}
  ${modelsTable}
  ${recsHTML}
  <div class="footer">Generated by <a href="https://overlap.dev">overlap</a></div>
</div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
</body>
</html>`;
}

function contentToMarkdown(content: InsightContent, periodLabel: string, insight: Insight): string {
  const s = content.stats;
  const lines: string[] = [];

  lines.push(`# ${periodLabel} — Insight Report`);
  lines.push('');
  lines.push(`> Generated by [Overlap](https://overlap.dev) on ${insight.generated_at ? new Date(insight.generated_at).toLocaleDateString() : 'N/A'}${insight.model_used ? ` · Model: ${insight.model_used}` : ''}`);
  lines.push('');

  if (content.summary) {
    lines.push(content.summary);
    lines.push('');
  }

  lines.push('## Key Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Sessions | ${s.total_sessions} |`);
  lines.push(`| Cost | ${formatCost(s.total_cost_usd)} |`);
  lines.push(`| Files Touched | ${s.total_files_touched} |`);
  lines.push(`| Prompts | ${s.total_prompts} |`);
  lines.push(`| Avg Session | ${formatDuration(s.avg_session_duration_ms)} |`);
  lines.push(`| Total Tokens | ${formatTokens(s.total_input_tokens + s.total_output_tokens)} |`);
  if (s.total_overlaps > 0) {
    lines.push(`| Overlaps | ${s.total_overlaps} |`);
    lines.push(`| Blocked | ${s.total_blocks} |`);
  }
  lines.push('');

  if (content.highlights?.length) {
    lines.push('## Highlights');
    lines.push('');
    content.highlights.forEach(h => lines.push(`- ${h}`));
    lines.push('');
  }

  if (content.facet_stats && content.facet_stats.total_facets > 0) {
    lines.push('## Session Analysis');
    lines.push('');
    if (Object.keys(content.facet_stats.outcomes).length) {
      lines.push('**Outcomes:**');
      Object.entries(content.facet_stats.outcomes)
        .sort((a, b) => b[1] - a[1])
        .forEach(([outcome, count]) => lines.push(`- ${formatCategory(outcome)}: ${count}`));
      lines.push('');
    }
    if (Object.keys(content.facet_stats.session_types).length) {
      lines.push('**Session Types:**');
      Object.entries(content.facet_stats.session_types)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => lines.push(`- ${formatCategory(type)}: ${count}`));
      lines.push('');
    }
    if (content.facet_stats.top_goal_categories?.length) {
      lines.push('**Top Work Categories:**');
      content.facet_stats.top_goal_categories.slice(0, 6).forEach(g =>
        lines.push(`- ${formatCategory(g.category)}: ${g.count}`)
      );
      lines.push('');
    }
  }

  if (content.project_areas?.length) {
    lines.push('## What You Worked On');
    lines.push('');
    content.project_areas.forEach(area => {
      lines.push(`### ${area.name} (${area.session_count} session${area.session_count !== 1 ? 's' : ''})`);
      lines.push('');
      lines.push(area.description);
      lines.push('');
    });
  }

  if (content.interaction_style) {
    lines.push('## How You Use the Agent');
    lines.push('');
    lines.push(content.interaction_style);
    lines.push('');
  }

  if (content.narrative) {
    lines.push('## Analysis');
    lines.push('');
    lines.push(content.narrative);
    lines.push('');
  }

  if (content.accomplishments?.length) {
    lines.push('## Accomplishments');
    lines.push('');
    content.accomplishments.forEach(a => {
      lines.push(`**${a.title}**`);
      lines.push(a.description);
      lines.push('');
    });
  }

  if (content.friction_analysis?.length) {
    lines.push('## Where Things Went Wrong');
    lines.push('');
    content.friction_analysis.forEach(f => {
      lines.push(`### ${f.category}`);
      lines.push('');
      lines.push(f.description);
      if (f.examples?.length) {
        lines.push('');
        f.examples.forEach(ex => lines.push(`- ${ex}`));
      }
      lines.push('');
    });
  }

  if (content.by_repo?.length) {
    lines.push('## Repositories');
    lines.push('');
    lines.push('| Repo | Sessions | Files | Cost |');
    lines.push('|------|----------|-------|------|');
    content.by_repo.forEach(r => lines.push(`| ${r.repo_name} | ${r.session_count} | ${r.file_count} | ${formatCost(r.cost)} |`));
    lines.push('');
  }

  if (content.tool_usage?.length) {
    lines.push('## Tool Usage');
    lines.push('');
    lines.push('| Tool | Count |');
    lines.push('|------|-------|');
    content.tool_usage.slice(0, 8).forEach(t => lines.push(`| ${t.tool_name} | ${t.count} |`));
    lines.push('');
  }

  if (content.hottest_files?.length) {
    lines.push('## Most Active Files');
    lines.push('');
    lines.push('| File | Repo | Edits | Users |');
    lines.push('|------|------|-------|-------|');
    content.hottest_files.slice(0, 8).forEach(f => lines.push(`| ${f.file_path} | ${f.repo_name} | ${f.edit_count} | ${f.user_count} |`));
    lines.push('');
  }

  if (content.by_model?.length) {
    lines.push('## Models Used');
    lines.push('');
    lines.push('| Model | Sessions | Cost |');
    lines.push('|-------|----------|------|');
    content.by_model.forEach(m => lines.push(`| ${m.model} | ${m.session_count} | ${formatCost(m.cost)} |`));
    lines.push('');
  }

  const recs = (content.recommendations || []).map(r =>
    typeof r === 'string' ? { title: r, description: '' } : r
  );
  if (recs.length) {
    lines.push('## Recommendations');
    lines.push('');
    recs.forEach(r => {
      lines.push(`**${r.title}**`);
      if (r.description) lines.push(r.description);
      lines.push('');
    });
  }

  lines.push('---');
  lines.push('*Generated by [Overlap](https://overlap.dev)*');

  return lines.join('\n');
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
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleExportPDF = () => {
    setExportOpen(false);
    const html = contentToPrintHTML(content, periodLabel, insight);
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  const handleCopyMarkdown = async () => {
    setExportOpen(false);
    const md = contentToMarkdown(content, periodLabel, insight);
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
        <div className="report-actions">
          <div className="export-dropdown-wrap" ref={exportRef}>
            <button className="export-dropdown-trigger" onClick={() => setExportOpen(o => !o)}>
              Export <span className="dropdown-caret">{exportOpen ? '\u25B4' : '\u25BE'}</span>
            </button>
            {exportOpen && (
              <div className="export-dropdown-menu">
                <button className="export-option" onClick={handleExportPDF}>Download as PDF</button>
                <button className="export-option" onClick={handleCopyMarkdown}>
                  {copied ? 'Copied!' : 'Copy as Markdown'}
                </button>
              </div>
            )}
          </div>
          {canRegenerate && (
            <button className="btn-regenerate" onClick={onRegenerate} disabled={generating}>
              {generating ? 'Regenerating...' : 'Regenerate'}
            </button>
          )}
        </div>
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
