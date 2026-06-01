"use client";

import { useState, useCallback, useEffect } from "react";
import type { Insight, InsightQuery, MetricData, TimeSeriesData, BreakdownItem, FunnelData, RetentionData, TimeRange } from "@/lib/types";
import { MetricCard } from "./metric-card";
import { AreaChart } from "./area-chart";
import { Breakdown } from "./breakdown";
import { Funnel } from "./funnel";
import { Retention } from "./retention";
import { InsightConfigurator } from "./configurator";
import { ChevronDown, Clock, Plus, X, Pencil, Settings, Trash2, Star, Maximize2, Minimize2, GripVertical, Share2, Link2, Copy } from "lucide-react";
import { useProjects } from "./dashboard-shell";
import { EditableText } from "@/components/editable-text";
import { ActionButton } from "@/components/action-button";
import { Onboarding } from "./onboarding";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";

function InsightRenderer({ insight }: { insight: Insight }) {
  if (!insight.data) {
    return (
      <div className="w-full bg-surface-1 border border-border rounded-lg p-5">
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

const SPAN_CYCLE: Record<number, number> = { 1: 2, 2: 3, 3: 1 };
const SPAN_LABELS: Record<number, string> = { 1: "Small", 2: "Medium", 3: "Full width" };

const timeRanges = ["Last 24 hours", "Last 7 days", "Last 30 days", "Last 90 days"];

const timeRangeMap: Record<string, TimeRange> = {
  "Last 24 hours": { type: "relative", value: 24, unit: "hours" },
  "Last 7 days": { type: "relative", value: 7, unit: "days" },
  "Last 30 days": { type: "relative", value: 30, unit: "days" },
  "Last 90 days": { type: "relative", value: 90, unit: "days" },
};

type Props = {
  initialInsights: Insight[];
  projectId: string;
  projectKey?: string;
  dashboardId: string | null;
  dashboardName?: string;
  isDefault?: boolean;
  shareToken?: string | null;
  onDashboardRename?: (name: string) => void;
  onDashboardDelete?: () => void;
  onSetDefault?: () => void;
};

export function DashboardView({ initialInsights, projectId, projectKey, dashboardId, dashboardName = "Dashboard", isDefault, shareToken: initialShareToken, onDashboardRename, onDashboardDelete, onSetDefault }: Props) {
  const [insights, setInsights] = useState(initialInsights);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState(dashboardName);
  const [timeRange, setTimeRange] = useState("Last 30 days");
  const [timeOpen, setTimeOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [shareToken, setShareToken] = useState(initialShareToken);
  const [shareCopied, setShareCopied] = useState(false);
  const projects = useProjects();

  useEffect(() => setMounted(true), []);
  useEffect(() => setInsights(initialInsights), [initialInsights]);
  useEffect(() => setName(dashboardName), [dashboardName]);

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

  const persistLayout = useCallback(async (updated: Insight[]) => {
    if (!dashboardId) return;
    const layout = {
      insights: updated.map((ins) => ({
        id: ins.id,
        type: ins.type,
        title: ins.title,
        span: ins.span,
        query: ins.query ?? { measure: "count" as const },
        projectId: ins.projectId ?? projectId,
      })),
    };
    await fetch(`/api/v0/dashboards/${dashboardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout }),
    });
  }, [dashboardId, projectId]);

  const refreshInsights = useCallback(async () => {
    const res = await fetch("/api/v0/dashboard-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, timeRange: timeRangeMap[timeRange] }),
    });
    if (res.ok) {
      const data = await res.json();
      setInsights(data.insights);
    }
  }, [projectId, timeRange]);

  async function handleTimeRangeChange(tr: string) {
    setTimeRange(tr);
    setTimeOpen(false);
    setLoading(true);
    try {
      const res = await fetch("/api/v0/dashboard-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, timeRange: timeRangeMap[tr] }),
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
          span: config.type === "metric" ? 1 as const : (config.span ?? ins.span),
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

  function resizeInsight(insightId: string) {
    setInsights((prev) => {
      const updated = prev.map((ins) =>
        ins.id === insightId
          ? { ...ins, span: (SPAN_CYCLE[ins.span] ?? 2) as 1 | 2 | 3 | 4 }
          : ins,
      );
      persistLayout(updated);
      return updated;
    });
  }

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return;
    const from = result.source.index;
    const to = result.destination.index;
    if (from === to) return;

    setInsights((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(from, 1);
      updated.splice(to, 0, moved);
      persistLayout(updated);
      return updated;
    });
  }

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

      {/* Insights grid with drag-and-drop */}
      {mounted ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="insights" direction="horizontal">
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="grid grid-cols-3 gap-4"
              >
                {insights.map((insight, index) => (
                  <Draggable key={insight.id} draggableId={insight.id} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`relative group/insight w-full ${snapshot.isDragging ? "z-50 opacity-90" : ""}`}
                        style={{
                          gridColumn: `span ${Math.min(insight.span, 3)}`,
                          ...provided.draggableProps.style,
                        }}
                      >
                        {editingId === insight.id ? (
                          <InsightConfigurator
                            initialInsight={insight}
                            projects={projects}
                            timeRange={timeRangeMap[timeRange]}
                            onConfigChange={(config) => handleConfigChange(insight.id, config)}
                            onDismiss={() => dismissConfigurator(insight.id)}
                          />
                        ) : (
                          <>
                            <InsightRenderer insight={insight} />
                            <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover/insight:opacity-100 transition-all">
                              <div
                                {...provided.dragHandleProps}
                                className="p-1 rounded-full bg-surface-2 border border-border text-text-tertiary hover:text-text-primary shadow-sm transition-colors cursor-grab active:cursor-grabbing"
                              >
                                <GripVertical className="w-3 h-3" />
                              </div>
                              <ActionButton
                                label={SPAN_LABELS[SPAN_CYCLE[insight.span] ?? 2]}
                                onClick={() => resizeInsight(insight.id)}
                                icon={insight.span >= 3 ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                                className="p-1 rounded-full bg-surface-2 border border-border text-text-tertiary hover:text-accent hover:border-accent/40 shadow-sm transition-colors"
                              />
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
                          </>
                        )}
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {insights.map((insight) => (
            <div key={insight.id} className="w-full" style={{ gridColumn: `span ${Math.min(insight.span, 3)}` }}>
              <InsightRenderer insight={insight} />
            </div>
          ))}
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
