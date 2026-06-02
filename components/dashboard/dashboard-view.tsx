"use client";

import { useState, useCallback, useEffect } from "react";
import type { Insight, InsightQuery, MetricData, TimeSeriesData, BreakdownItem, FunnelData, RetentionData, TimeRange } from "@/lib/types";
import { MetricCard } from "./metric-card";
import { AreaChart } from "./area-chart";
import { Breakdown } from "./breakdown";
import { Funnel } from "./funnel";
import { Retention } from "./retention";
import { InsightConfigurator } from "./configurator";
import { ChevronDown, Clock, Plus, X, Pencil, Settings, Trash2, Star, Scaling, GripVertical, Share2, Link2, Check, Rows3 } from "lucide-react";
import { useProjects } from "./dashboard-shell";
import { EditableText } from "@/components/editable-text";
import { ActionButton } from "@/components/action-button";
import { Onboarding } from "./onboarding";
import { AgentSetup } from "./agent-setup";
import { EventPulse } from "./event-pulse";
import GridLayout, { useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";

// Grid cells are fixed-height (react-grid-layout requires explicit h). Heights
// are per insight type; the one being configured gets extra room.
const TYPE_HEIGHT: Record<string, number> = { metric: 2, timeseries: 4, breakdown: 4, funnel: 4, retention: 4 };
const COMPACT_TYPE_HEIGHT: Record<string, number> = { metric: 2, timeseries: 3, breakdown: 3, funnel: 3, retention: 3 };
const ROW_HEIGHT = 72;
const COMPACT_ROW_HEIGHT = 56;
const COLS = 3;
const MIN_H = 2;

function InsightRenderer({ insight }: { insight: Insight }) {
  if (!insight.data) {
    return (
      <div className="w-full h-full bg-surface-1 border border-border rounded-lg p-5">
        <div className="text-xs text-text-secondary uppercase tracking-wider mb-3">{insight.title || "Untitled"}</div>
        <div className="h-20 flex items-center justify-center text-text-tertiary text-sm">No data</div>
      </div>
    );
  }

  switch (insight.type) {
    case "metric": {
      const m = insight.data as MetricData;
      return <MetricCard title={insight.title} data={{ value: m?.value ?? "0", trend: m?.trend ?? 0, sparkline: m?.sparkline ?? [] }} />;
    }
    case "timeseries": {
      const ts = insight.data as TimeSeriesData;
      return <AreaChart title={insight.title} data={{ labels: ts?.labels ?? [], values: ts?.values ?? [] }} />;
    }
    case "breakdown":
      return <Breakdown title={insight.title} items={(insight.data as { items?: BreakdownItem[] })?.items ?? []} />;
    case "funnel":
      return <Funnel title={insight.title} steps={(insight.data as FunnelData)?.steps ?? []} />;
    case "retention":
      return <Retention title={insight.title} data={(insight.data as RetentionData) ?? { cohorts: [], periods: [] }} />;
  }
}

const SIZE_OPTIONS: { span: 1 | 2 | 3; label: string }[] = [
  { span: 1, label: "Small" },
  { span: 2, label: "Medium" },
  { span: 3, label: "Full width" },
];

const timeRanges = ["Last 24 hours", "Last 7 days", "Last 30 days", "Last 90 days"];

const timeRangeMap: Record<string, TimeRange> = {
  "Last 24 hours": { type: "relative", value: 24, unit: "hours" },
  "Last 7 days": { type: "relative", value: 7, unit: "days" },
  "Last 30 days": { type: "relative", value: 30, unit: "days" },
  "Last 90 days": { type: "relative", value: 90, unit: "days" },
};

// Skyline pack: drop each card (in order) into the lowest left-aligned slot wide
// enough for its span — so cards float left and fill vertical gaps a short card
// would otherwise leave under a tall neighbour. Ties go to the leftmost column,
// which keeps reading order and the left-aligned feel.
function computeLayout(insights: Insight[], compact: boolean): LayoutItem[] {
  const heights = compact ? COMPACT_TYPE_HEIGHT : TYPE_HEIGHT;
  const colBottom = new Array(COLS).fill(0); // next free y per column
  const layout: LayoutItem[] = [];
  for (const ins of insights) {
    const w = Math.min(ins.span ?? 2, COLS);
    const h = ins.height ?? heights[ins.type] ?? 3;
    let bestX = 0;
    let bestY = Infinity;
    for (let x = 0; x + w <= COLS; x++) {
      let y = 0;
      for (let c = x; c < x + w; c++) y = Math.max(y, colBottom[c]);
      if (y < bestY) { bestY = y; bestX = x; }
    }
    layout.push({ i: ins.id, x: bestX, y: bestY, w, h, minH: MIN_H });
    for (let c = bestX; c < bestX + w; c++) colBottom[c] = bestY + h;
  }
  return layout;
}

type Props = {
  initialInsights: Insight[];
  projectId: string;
  projectKey?: string;
  dashboardId: string | null;
  dashboardName?: string;
  isDefault?: boolean;
  shareToken?: string | null;
  compact?: boolean;
  onDashboardRename?: (name: string) => void;
  onDashboardDelete?: () => void;
  onSetDefault?: () => void;
};

export function DashboardView({ initialInsights, projectId, projectKey, dashboardId, dashboardName = "Dashboard", isDefault, shareToken: initialShareToken, compact: initialCompact, onDashboardRename, onDashboardDelete, onSetDefault }: Props) {
  const [insights, setInsights] = useState(initialInsights);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState(dashboardName);
  const [timeRange, setTimeRange] = useState("Last 30 days");
  const [timeOpen, setTimeOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [shareToken, setShareToken] = useState(initialShareToken);
  const [shareCopied, setShareCopied] = useState(false);
  const [compact, setCompact] = useState(initialCompact ?? false);
  const [sizeMenuFor, setSizeMenuFor] = useState<string | null>(null);
  const projects = useProjects();
  const { width, containerRef, mounted } = useContainerWidth();

  useEffect(() => setInsights(initialInsights), [initialInsights]);
  useEffect(() => setName(dashboardName), [dashboardName]);
  useEffect(() => setCompact(initialCompact ?? false), [initialCompact]);

  async function renameDashboard(newName: string) {
    setName(newName);
    onDashboardRename?.(newName);
    if (!dashboardId) return;
    await fetch(`/api/v0/dashboards/${dashboardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
  }

  async function deleteDashboard() {
    if (!dashboardId) return;
    const res = await fetch(`/api/v0/dashboards/${dashboardId}`, { method: "DELETE" });
    if (res.ok || res.status === 204) {
      onDashboardDelete?.();
    }
  }

  const persistLayout = useCallback(async (updated: Insight[], compactFlag = compact) => {
    if (!dashboardId) return;
    const layout = {
      compact: compactFlag,
      insights: updated.map((ins) => ({
        id: ins.id,
        type: ins.type,
        title: ins.title,
        span: ins.span,
        height: ins.height,
        query: ins.query ?? { measure: "count" as const },
        projectId: ins.projectId ?? projectId,
      })),
    };
    await fetch(`/api/v0/dashboards/${dashboardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout }),
    });
  }, [dashboardId, projectId, compact]);

  function toggleCompact() {
    setCompact((prev) => {
      const next = !prev;
      persistLayout(insights, next);
      return next;
    });
    setMenuOpen(false);
  }

  const refreshInsights = useCallback(async () => {
    const res = await fetch("/api/v0/dashboard-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, dashboardId, timeRange: timeRangeMap[timeRange] }),
    });
    if (res.ok) {
      const data = await res.json();
      setInsights(data.insights);
    }
  }, [projectId, dashboardId, timeRange]);

  async function handleTimeRangeChange(tr: string) {
    setTimeRange(tr);
    setTimeOpen(false);
    setLoading(true);
    try {
      const res = await fetch("/api/v0/dashboard-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, dashboardId, timeRange: timeRangeMap[tr] }),
      });
      if (res.ok) {
        const data = await res.json();
        setInsights(data.insights);
      }
    } finally {
      setLoading(false);
    }
  }

  function removeInsight(insightId: string) {
    setInsights((prev) => {
      const updated = prev.filter((ins) => ins.id !== insightId);
      persistLayout(updated).then(() => refreshInsights());
      return updated;
    });
  }

  function addInsight() {
    const id = `ins_${Date.now()}`;
    const insight: Insight = {
      id,
      type: "breakdown",
      title: "",
      span: 2,
      data: { items: [] },
      query: { measure: "count" },
      projectId,
    };
    setInsights((prev) => [...prev, insight]);
    setEditingId(id);
  }

  function handleConfigChange(insightId: string, config: Partial<Insight> & { query: InsightQuery }) {
    setInsights((prev) => {
      const updated = prev.map((ins) => {
        if (ins.id !== insightId) return ins;
        const typeChanged = config.type && config.type !== ins.type;
        const defaultData = config.type === "metric"
          ? { value: "0", trend: 0, sparkline: [] }
          : config.type === "timeseries"
            ? { labels: [], values: [] }
            : config.type === "funnel"
              ? { steps: [] }
              : config.type === "retention"
                ? { cohorts: [], periods: [] }
                : { items: [] };
        return {
          ...ins,
          ...config,
          data: typeChanged ? defaultData : ins.data,
          // Preserve the user's width/height — the configurator always reports a
          // default span, which would otherwise reset a resized card.
          span: config.type === "metric" ? 1 as const : ins.span,
          height: ins.height,
        };
      });
      persistLayout(updated);
      return updated;
    });
  }

  function dismissConfigurator(insightId: string) {
    setEditingId(null);
    refreshInsights();
  }

  function setInsightSpan(insightId: string, span: 1 | 2 | 3) {
    setSizeMenuFor(null);
    setInsights((prev) => {
      if (prev.find((i) => i.id === insightId)?.span === span) return prev;
      const updated = prev.map((ins) => (ins.id === insightId ? { ...ins, span } : ins));
      persistLayout(updated);
      return updated;
    });
  }

  // After a drag: re-derive order from the new grid positions, and auto-size the
  // dragged card by how far right the cursor went — left third -> 1 column,
  // middle -> 2, right third -> full width (left-aligned, grows rightward).
  function handleDragStop(newLayout: Layout, dropped: LayoutItem | null, event?: Event) {
    const order = [...newLayout].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.i);

    // Cursor column from the drop x relative to the grid (independent of the
    // card's current width, so even a full-width card can be narrowed).
    let span: 1 | 2 | 3 | 4 | null = null;
    if (dropped) {
      const rect = containerRef.current?.getBoundingClientRect();
      const clientX = (event as MouseEvent | undefined)?.clientX;
      if (rect && typeof clientX === "number" && rect.width > 0) {
        const col = Math.floor(((clientX - rect.left) / rect.width) * COLS);
        span = (Math.min(Math.max(col, 0), COLS - 1) + 1) as 1 | 2 | 3;
      } else {
        span = (Math.min(dropped.x, COLS - 1) + 1) as 1 | 2 | 3;
      }
    }

    setInsights((prev) => {
      const byId = new Map(prev.map((i) => [i.id, i]));
      let reordered = order.map((id) => byId.get(id)).filter(Boolean) as Insight[];
      if (reordered.length !== prev.length) return prev;

      let sizeChanged = false;
      if (dropped && span !== null) {
        reordered = reordered.map((ins) => {
          if (ins.id !== dropped.i || ins.span === span) return ins;
          sizeChanged = true;
          return { ...ins, span: span! };
        });
      }

      const orderChanged = reordered.some((ins, i) => ins.id !== prev[i].id);
      if (!orderChanged && !sizeChanged) return prev;
      persistLayout(reordered);
      return reordered;
    });
  }

  // An agent-eval dashboard is recognisable by its insights filtering on agent
  // events — show the plugin-setup card on it until the first event arrives.
  const isAgentDashboard = insights.some((i) =>
    i.query?.eventFilter?.names?.some((n) =>
      n === "tool_use" || n === "file_edit" || n === "command_run" || n === "session_start" || n === "session_end",
    ),
  );

  return (
    <div className="flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2 group/title">
          <EditableText
            value={name}
            onCommit={renameDashboard}
            onEditingChange={setTitleEditing}
            className="text-xl font-semibold"
          />
          {dashboardId && !titleEditing && (
            <div className="relative">
              <ActionButton
                label="Dashboard settings"
                onClick={() => setMenuOpen(!menuOpen)}
                icon={<Settings className="w-4 h-4" />}
                className="p-1 text-text-tertiary hover:text-accent transition-colors"
              />
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 bg-surface-2 border border-border rounded-md shadow-lg z-50 py-1 min-w-[160px]">
                    <button
                      onClick={async () => {
                        if (shareToken) {
                          await fetch(`/api/v0/dashboards/${dashboardId}/share`, { method: "DELETE" });
                          setShareToken(null);
                        } else {
                          const res = await fetch(`/api/v0/dashboards/${dashboardId}/share`, { method: "POST" });
                          if (res.ok) {
                            const { shareToken: token } = await res.json();
                            setShareToken(token);
                          }
                        }
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors flex items-center gap-1.5"
                    >
                      <Share2 className="w-3 h-3" />
                      {shareToken ? "Disable sharing" : "Share publicly"}
                    </button>
                    {shareToken && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/share/${shareToken}`);
                          setShareCopied(true);
                          setTimeout(() => setShareCopied(false), 2000);
                          setMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors flex items-center gap-1.5"
                      >
                        <Link2 className="w-3 h-3" />
                        {shareCopied ? "Copied!" : "Copy share link"}
                      </button>
                    )}
                    <button
                      onClick={toggleCompact}
                      className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors flex items-center gap-1.5"
                    >
                      <Rows3 className="w-3 h-3" />
                      <span className="flex-1">Compact layout</span>
                      {compact && <Check className="w-3 h-3 text-accent" />}
                    </button>
                    {!isDefault && (
                      <>
                        <button
                          onClick={() => { setMenuOpen(false); onSetDefault?.(); }}
                          className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors flex items-center gap-1.5"
                        >
                          <Star className="w-3 h-3" />
                          Set as default
                        </button>
                        <button
                          onClick={() => { setMenuOpen(false); deleteDashboard(); }}
                          className="w-full text-left px-3 py-1.5 text-xs text-error hover:bg-error/10 transition-colors flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete dashboard
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          {projectId && !titleEditing && <EventPulse projectId={projectId} />}
        </div>
        <div className="flex items-center gap-2">
          {dashboardId && (
            <ActionButton
              label="Add insight"
              onClick={addInsight}
              icon={<Plus className="w-4 h-4" />}
              className="p-1.5 text-text-tertiary hover:text-accent transition-colors"
            />
          )}

          <div className="relative">
            <button
              onClick={() => setTimeOpen(!timeOpen)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary bg-surface-1 border border-border rounded-md hover:border-border-hover transition-colors"
            >
              <Clock className="w-3.5 h-3.5" />
              {timeRange}
              {loading && <span className="ml-1 text-text-tertiary">...</span>}
              <ChevronDown className={`w-3 h-3 transition-transform ${timeOpen ? "rotate-180" : ""}`} />
            </button>
            {timeOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setTimeOpen(false)} />
                <div className="absolute right-0 top-full mt-1 bg-surface-2 border border-border rounded-md shadow-lg z-50 py-1 min-w-[160px]">
                  {timeRanges.map((tr) => (
                    <button
                      key={tr}
                      onClick={() => handleTimeRangeChange(tr)}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        tr === timeRange
                          ? "text-accent bg-accent/8"
                          : "text-text-secondary hover:text-text-primary hover:bg-surface-3"
                      }`}
                    >
                      {tr}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {isAgentDashboard && projectKey && dashboardId && (
        <AgentSetup projectKey={projectKey} projectId={projectId} />
      )}

      {/* Insight grid. react-grid-layout keeps every card inside the grid and
          compacts vertically; only the dragged card shrinks (CSS in globals). */}
      <div ref={containerRef}>
      {mounted && width > 0 && insights.length > 0 ? (
        <GridLayout
          className="layout"
          width={width}
          layout={computeLayout(insights, compact)}
          gridConfig={{ cols: COLS, rowHeight: compact ? COMPACT_ROW_HEIGHT : ROW_HEIGHT, margin: compact ? [8, 8] : [16, 16], containerPadding: [0, 0] }}
          dragConfig={{ enabled: !editingId, handle: ".drag-handle" }}
          resizeConfig={{ enabled: false }}
          onDragStop={(l: Layout, _old: LayoutItem | null, dropped: LayoutItem | null, _ph: LayoutItem | null, event: Event) => handleDragStop(l, dropped, event)}
        >
          {insights.map((insight) => (
            <div key={insight.id} data-insight-id={insight.id} className="h-full">
              <div className="relative group/insight h-full">
                  <div className="insight-card h-full overflow-hidden">
                    <InsightRenderer insight={insight} />
                  </div>
                  <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover/insight:opacity-100 transition-all z-10">
                    <button
                      className="drag-handle p-1 rounded-full bg-surface-2 border border-border text-text-tertiary hover:text-text-primary shadow-sm transition-colors cursor-grab active:cursor-grabbing touch-none"
                      aria-label="Drag to reorder"
                      data-drag-handle
                    >
                      <GripVertical className="w-3 h-3" />
                    </button>
                    <div className="relative">
                      <ActionButton
                        label="Resize"
                        onClick={() => setSizeMenuFor(sizeMenuFor === insight.id ? null : insight.id)}
                        icon={<Scaling className="w-3 h-3" />}
                        className="p-1 rounded-full bg-surface-2 border border-border text-text-tertiary hover:text-accent hover:border-accent/40 shadow-sm transition-colors"
                      />
                      {sizeMenuFor === insight.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setSizeMenuFor(null)} />
                          <div className="absolute right-0 top-full mt-1 bg-surface-2 border border-border rounded-md shadow-lg z-50 py-1 min-w-[120px]">
                            {SIZE_OPTIONS.map((opt) => (
                              <button
                                key={opt.span}
                                onClick={() => setInsightSpan(insight.id, opt.span)}
                                className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-1.5 ${
                                  insight.span === opt.span
                                    ? "text-accent bg-accent/8"
                                    : "text-text-secondary hover:text-text-primary hover:bg-surface-3"
                                }`}
                              >
                                <span className="flex-1">{opt.label}</span>
                                {insight.span === opt.span && <Check className="w-3 h-3" />}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <ActionButton
                      label="Configure"
                      onClick={() => setEditingId(insight.id)}
                      icon={<Pencil className="w-3 h-3" />}
                      className="p-1 rounded-full bg-surface-2 border border-border text-text-tertiary hover:text-accent hover:border-accent/40 shadow-sm transition-colors"
                    />
                    <ActionButton
                      label="Remove"
                      onClick={() => removeInsight(insight.id)}
                      icon={<X className="w-3 h-3" />}
                      className="p-1 rounded-full bg-surface-2 border border-border text-text-tertiary hover:text-error hover:border-error/40 shadow-sm transition-colors"
                    />
                  </div>
                </div>
            </div>
          ))}
        </GridLayout>
      ) : null}
      </div>

      {/* Configure as a modal overlay — blurs the grid and floats an expanded
          editor on top, so editing never reflows the dashboard underneath. */}
      {editingId && (() => {
        const ins = insights.find((i) => i.id === editingId);
        if (!ins) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-6"
            onClick={() => dismissConfigurator(editingId)}
          >
            <div className="w-full max-w-2xl my-6" onClick={(e) => e.stopPropagation()}>
              <InsightConfigurator
                initialInsight={ins}
                projects={projects}
                timeRange={timeRangeMap[timeRange]}
                onConfigChange={(config) => handleConfigChange(editingId, config)}
                onDismiss={() => dismissConfigurator(editingId)}
              />
            </div>
          </div>
        );
      })()}

      {insights.length === 0 && (
        <Onboarding
          projectKey={projectKey ?? ""}
          projectId={projectId}
          host={typeof window !== "undefined" ? window.location.origin : ""}
          onInsightCreated={addInsight}
        />
      )}
    </div>
  );
}
