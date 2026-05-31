"use client";

import { useState, useCallback, useEffect } from "react";
import type { Insight, InsightQuery, MetricData, TimeSeriesData, BreakdownItem, TimeRange } from "@/lib/types";
import { MetricCard } from "./metric-card";
import { AreaChart } from "./area-chart";
import { Breakdown } from "./breakdown";
import { InsightConfigurator } from "./configurator";
import { ChevronDown, Clock, Plus, X, Pencil, Settings, Trash2, Star } from "lucide-react";
import Masonry, { ResponsiveMasonry } from "react-responsive-masonry";
import { useProjects } from "./dashboard-shell";
import { EditableText } from "@/components/editable-text";
import { ActionButton } from "@/components/action-button";

function InsightRenderer({ insight }: { insight: Insight }) {
  switch (insight.type) {
    case "metric":
      return <MetricCard title={insight.title} data={insight.data as MetricData} />;
    case "timeseries": {
      const ts = insight.data as TimeSeriesData;
      return <AreaChart title={insight.title} data={{ labels: ts?.labels ?? [], values: ts?.values ?? [] }} />;
    }
    case "breakdown":
      return <Breakdown title={insight.title} items={(insight.data as { items?: BreakdownItem[] })?.items ?? []} />;
  }
}

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
  dashboardId: string | null;
  dashboardName?: string;
  isDefault?: boolean;
  onDashboardRename?: (name: string) => void;
  onDashboardDelete?: () => void;
  onSetDefault?: () => void;
};

export function DashboardView({ initialInsights, projectId, dashboardId, dashboardName = "Dashboard", isDefault, onDashboardRename, onDashboardDelete, onSetDefault }: Props) {
  const [insights, setInsights] = useState(initialInsights);
  const [name, setName] = useState(dashboardName);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState("Last 30 days");
  const [timeOpen, setTimeOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
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
      const updated = prev.map((ins) =>
        ins.id === insightId
          ? { ...ins, ...config, span: config.type === "metric" ? 1 as const : (config.span ?? ins.span) }
          : ins,
      );
      persistLayout(updated);
      return updated;
    });
  }

  function dismissConfigurator(insightId: string) {
    setEditingId(null);
    refreshInsights();
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
          {dashboardId && !titleEditing && !isDefault && (
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

      {/* Insights mosaic — client-only to avoid hydration mismatch */}
      {!mounted ? (
        <div className="grid grid-cols-2 gap-4">
          {insights.map((insight) => (
            <div key={insight.id} className="w-full">
              <InsightRenderer insight={insight} />
            </div>
          ))}
        </div>
      ) : (
      <ResponsiveMasonry columnsCountBreakPoints={{ 0: 1, 640: 2, 1200: 3 }}>
        <Masonry gutter="1rem">
          {insights.map((insight) => (
            <div key={insight.id} className="relative group/insight w-full">
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
          ))}
        </Masonry>
      </ResponsiveMasonry>
      )}

      {insights.length === 0 && (
        <div className="text-center py-16 text-text-tertiary">
          {projects.length === 0 ? (
            <>
              <p className="text-sm">No projects yet.</p>
              <p className="text-xs mt-1">Create a project to start collecting events.</p>
            </>
          ) : (
            <>
              <p className="text-sm">This dashboard is empty.</p>
              <button
                onClick={addInsight}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add your first insight
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
