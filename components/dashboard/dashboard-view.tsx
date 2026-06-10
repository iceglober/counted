"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Insight, InsightQuery, MetricData, TimeSeriesData, BreakdownItem, FunnelData, RetentionData, TimeRange, SummaryStat } from "@/lib/types";
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
const COLS = 12; // 12-col grid so rows can split into even halves/thirds.
const MIN_H = 2;

// Max cards per row, responsive to the canvas width. Each auto card is at least
// COLS / maxPerRow wide, so rows hold up to N evenly-sized cards.
function maxPerRow(width: number): number {
  return width >= 1024 ? 3 : width >= 600 ? 2 : 1;
}

function InsightRenderer({ insight, onSummaryChange }: { insight: Insight; onSummaryChange?: (stat: SummaryStat) => void }) {
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
      return (
        <AreaChart
          title={insight.title}
          data={{ labels: ts?.labels ?? [], values: ts?.values ?? [], series: ts?.series }}
          bucket={insight.query?.timeBucket}
          summary={insight.summary}
          onSummaryChange={onSummaryChange}
        />
      );
    }
    case "breakdown":
      return <Breakdown title={insight.title} items={(insight.data as { items?: BreakdownItem[] })?.items ?? []} />;
    case "funnel":
      return <Funnel title={insight.title} steps={(insight.data as FunnelData)?.steps ?? []} />;
    case "retention":
      return <Retention title={insight.title} data={(insight.data as RetentionData) ?? { cohorts: [], periods: [] }} />;
  }
}

// Manual width overrides (out of 12 cols). 0 = auto: the card shares its row
// evenly with the other auto cards. A pin keeps its width; the row re-evens the rest.
const SIZE_OPTIONS: { span: number; label: string }[] = [
  { span: 0, label: "Auto" },
  { span: 4, label: "⅓" },
  { span: 6, label: "½" },
  { span: 8, label: "⅔" },
  { span: 12, label: "Full" },
];

const timeRanges = ["Last 24 hours", "Last 7 days", "Last 30 days", "Last 90 days"];

const timeRangeMap: Record<string, TimeRange> = {
  "Last 24 hours": { type: "relative", value: 24, unit: "hours" },
  "Last 7 days": { type: "relative", value: 7, unit: "days" },
  "Last 30 days": { type: "relative", value: 30, unit: "days" },
  "Last 90 days": { type: "relative", value: 90, unit: "days" },
};

// Even-width rows. Cards flow into rows of up to N (N by viewport); within a
// row, pinned cards keep their width and the remaining width splits evenly among
// the auto cards. So a row of 2 autos is 50/50, a row of 3 is thirds, and pinning
// one card to ½ leaves the rest of its row to share the other half.
function pinWidth(ins: Insight, minUnit: number): number {
  const s = ins.span ?? 0;
  return s >= 4 ? Math.min(Math.max(s, minUnit), COLS) : 0; // <4 (incl. legacy 1-3) = auto
}

function computeLayout(insights: Insight[], compact: boolean, n: number, draggingId?: string | null): LayoutItem[] {
  const heights = compact ? COMPACT_TYPE_HEIGHT : TYPE_HEIGHT;
  const minUnit = Math.max(1, Math.floor(COLS / n));
  // The in-flight card shrinks to one unit so its placeholder can slot into a
  // row; the row re-evens on drop.
  const widthOf = (ins: Insight) => (ins.id === draggingId ? minUnit : pinWidth(ins, minUnit));

  // 1. Group cards (in order) into rows of up to N, respecting pinned widths.
  const rows: Insight[][] = [];
  let row: Insight[] = [];
  let fixed = 0;
  for (const ins of insights) {
    const p = widthOf(ins);
    if (row.length > 0 && (row.length >= n || fixed + (p || minUnit) > COLS)) {
      rows.push(row);
      row = [];
      fixed = 0;
    }
    row.push(ins);
    fixed += p;
  }
  if (row.length) rows.push(row);

  // 2. Lay out each row: pins keep their width, autos share the remainder evenly.
  const layout: LayoutItem[] = [];
  let y = 0;
  for (const r of rows) {
    const pins = r.map(widthOf);
    const fixedSum = pins.reduce((a, b) => a + b, 0);
    const autos = pins.filter((p) => p === 0).length;
    const autoW = autos > 0 ? Math.floor((COLS - fixedSum) / autos) : 0;
    let rem = COLS - fixedSum - autoW * autos; // spread the leftover columns
    let x = 0;
    let rowH = 0;
    r.forEach((ins, i) => {
      let w = pins[i] || autoW + (rem-- > 0 ? 1 : 0);
      if (w < 1) w = 1;
      const h = ins.height ?? heights[ins.type] ?? 3;
      layout.push({ i: ins.id, x, y, w, h, minH: MIN_H });
      x += w;
      rowH = Math.max(rowH, h);
    });
    y += rowH;
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
  const n = maxPerRow(width);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ insight: Insight; index: number } | null>(null);
  const removedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

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
        summary: ins.summary,
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

  // Removal is immediate but forgiving: the insight is kept around briefly so
  // an accidental click on the X can be undone from the snackbar.
  function removeInsight(insightId: string) {
    const index = insights.findIndex((ins) => ins.id === insightId);
    if (index === -1) return;
    setRemoved({ insight: insights[index], index });
    clearTimeout(removedTimer.current);
    removedTimer.current = setTimeout(() => setRemoved(null), 6000);
    setInsights((prev) => {
      const updated = prev.filter((ins) => ins.id !== insightId);
      persistLayout(updated);
      return updated;
    });
  }

  function undoRemove() {
    if (!removed) return;
    const { insight, index } = removed;
    clearTimeout(removedTimer.current);
    setRemoved(null);
    setInsights((prev) => {
      if (prev.some((ins) => ins.id === insight.id)) return prev;
      const updated = [...prev];
      updated.splice(Math.min(index, updated.length), 0, insight);
      persistLayout(updated);
      return updated;
    });
  }

  function addInsight() {
    const id = `ins_${Date.now()}`;
    const insight: Insight = {
      id,
      type: "breakdown",
      title: "",
      span: 0,
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
          span: config.type === "metric" ? 4 : ins.span,
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

  function setInsightSpan(insightId: string, span: number) {
    setSizeMenuFor(null);
    setInsights((prev) => {
      if (prev.find((i) => i.id === insightId)?.span === span) return prev;
      const updated = prev.map((ins) => (ins.id === insightId ? { ...ins, span } : ins));
      persistLayout(updated);
      return updated;
    });
  }

  function setInsightSummary(insightId: string, summary: SummaryStat) {
    setInsights((prev) => {
      const updated = prev.map((ins) => (ins.id === insightId ? { ...ins, summary } : ins));
      persistLayout(updated);
      return updated;
    });
  }

  // Dragging the bottom edge sets an explicit height (in grid rows) for the
  // card; content reflows to the new room (denser or roomier, see breakdown).
  function handleResizeStop(item: LayoutItem | null) {
    if (!item) return;
    setInsights((prev) => {
      const ins = prev.find((i) => i.id === item.i);
      if (!ins || ins.height === item.h) return prev;
      const updated = prev.map((i) => (i.id === item.i ? { ...i, height: item.h } : i));
      persistLayout(updated);
      return updated;
    });
  }

  // After a drag, the only thing that changes is order — widths are derived by
  // computeLayout, so dropping a card into a row re-evens that row automatically.
  function handleDragStop(newLayout: Layout) {
    const order = [...newLayout].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.i);
    setInsights((prev) => {
      const byId = new Map(prev.map((i) => [i.id, i]));
      const reordered = order.map((id) => byId.get(id)).filter(Boolean) as Insight[];
      if (reordered.length !== prev.length) return prev;
      const orderChanged = reordered.some((ins, i) => ins.id !== prev[i].id);
      if (!orderChanged) return prev;
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
          layout={computeLayout(insights, compact, n, draggingId)}
          gridConfig={{ cols: COLS, rowHeight: compact ? COMPACT_ROW_HEIGHT : ROW_HEIGHT, margin: compact ? [8, 8] : [16, 16], containerPadding: [0, 0] }}
          dragConfig={{ enabled: !editingId, handle: ".drag-handle" }}
          resizeConfig={{ enabled: !editingId, handles: ["s"] }}
          onDragStart={(_l: Layout, oldItem: LayoutItem | null) => setDraggingId(oldItem?.i ?? null)}
          onDragStop={(l: Layout) => { setDraggingId(null); handleDragStop(l); }}
          onResizeStop={(_l: Layout, _old: LayoutItem | null, newItem: LayoutItem | null) => handleResizeStop(newItem)}
        >
          {insights.map((insight) => (
            <div key={insight.id} data-insight-id={insight.id} className="h-full">
              <div className="relative group/insight h-full">
                  <div className="insight-card h-full overflow-hidden">
                    <InsightRenderer
                      insight={insight}
                      onSummaryChange={insight.type === "timeseries" ? (stat) => setInsightSummary(insight.id, stat) : undefined}
                    />
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
                        label="Width"
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
                                  ((insight.span ?? 0) >= 4 ? insight.span : 0) === opt.span
                                    ? "text-accent bg-accent/8"
                                    : "text-text-secondary hover:text-text-primary hover:bg-surface-3"
                                }`}
                              >
                                <span className="flex-1">{opt.label}</span>
                                {((insight.span ?? 0) >= 4 ? insight.span : 0) === opt.span && <Check className="w-3 h-3" />}
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
                projectId={projectId}
                timeRange={timeRangeMap[timeRange]}
                onConfigChange={(config) => handleConfigChange(editingId, config)}
                onDismiss={() => dismissConfigurator(editingId)}
              />
            </div>
          </div>
        );
      })()}

      {/* Undo snackbar for insight removal */}
      {removed && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-surface-2 border border-border rounded-md shadow-lg pl-3 pr-1.5 py-1.5 animate-rise">
          <span className="text-xs text-text-secondary">
            Removed &ldquo;{removed.insight.title || "Untitled insight"}&rdquo;
          </span>
          <button
            onClick={undoRemove}
            className="px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10 rounded transition-colors"
          >
            Undo
          </button>
        </div>
      )}

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
