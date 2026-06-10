"use client";

import { useReducer, useEffect, useRef, useCallback } from "react";
import type { InsightQuery, Insight, InsightType, PropFilter, TimeRange } from "@/lib/types";
import { mapQueryResultToInsightData } from "@/lib/query-transform";
import { Dropdown } from "@/components/dropdown";
import { ConfigSection } from "./config-section";
import { TypePicker } from "./type-picker";
import { MeasurePicker } from "./measure-picker";
import { EventFilter } from "./event-filter";
import { PropertyFilters } from "./property-filters";
import { TimeBucketPicker } from "./time-bucket-picker";
import { X, Pencil } from "lucide-react";
import { LivePreview } from "./live-preview";

const SYSTEM_GROUP_BY = [
  { value: "event_name", label: "Event name" },
  { value: "os_name", label: "Operating system" },
  { value: "os_version", label: "OS version" },
  { value: "locale", label: "Locale" },
  { value: "app_version", label: "App version" },
  { value: "device_model", label: "Device model" },
];

const CUSTOM_AGGS = new Set(["sum", "avg", "min", "max"]);

// ─── State ─────────────────────────────────────────────────────────────────────

type SeriesRow = {
  measureType: string;
  measureProperty: string;
  eventFilter: string;
};

type ConfigState = {
  title: string;
  type: InsightType;
  projectId: string;
  measureType: string;
  measureProperty: string;
  eventFilter: string;
  /** Extra series plotted alongside the primary measure (timeseries only). */
  series: SeriesRow[];
  groupByKeys: string[];
  timeBucket: "hour" | "day" | "week" | "month";
  limit: number;
  propFilters: PropFilter[];
  funnelSteps: string[];
  retentionPeriod: "day" | "week" | "month";
  retentionPeriods: number;
};

type Action =
  | { type: "SET"; field: keyof ConfigState; value: unknown }
  | { type: "ADD_FILTER" }
  | { type: "UPDATE_FILTER"; index: number; filter: PropFilter }
  | { type: "REMOVE_FILTER"; index: number }
  | { type: "ADD_FUNNEL_STEP"; step: string }
  | { type: "REMOVE_FUNNEL_STEP"; index: number }
  | { type: "ADD_GROUP_BY" }
  | { type: "UPDATE_GROUP_BY"; index: number; value: string }
  | { type: "REMOVE_GROUP_BY"; index: number }
  | { type: "ADD_SERIES" }
  | { type: "UPDATE_SERIES"; index: number; patch: Partial<SeriesRow> }
  | { type: "REMOVE_SERIES"; index: number };

function reducer(state: ConfigState, action: Action): ConfigState {
  switch (action.type) {
    case "SET":
      return { ...state, [action.field]: action.value };
    case "ADD_FILTER":
      return { ...state, propFilters: [...state.propFilters, { field: "", operator: "eq", value: "" }] };
    case "UPDATE_FILTER":
      return { ...state, propFilters: state.propFilters.map((f, i) => i === action.index ? action.filter : f) };
    case "REMOVE_FILTER":
      return { ...state, propFilters: state.propFilters.filter((_, i) => i !== action.index) };
    case "ADD_FUNNEL_STEP":
      return { ...state, funnelSteps: [...state.funnelSteps, action.step] };
    case "REMOVE_FUNNEL_STEP":
      return { ...state, funnelSteps: state.funnelSteps.filter((_, i) => i !== action.index) };
    case "ADD_GROUP_BY":
      return { ...state, groupByKeys: [...state.groupByKeys, ""] };
    case "UPDATE_GROUP_BY":
      return { ...state, groupByKeys: state.groupByKeys.map((k, i) => (i === action.index ? action.value : k)) };
    case "REMOVE_GROUP_BY":
      return { ...state, groupByKeys: state.groupByKeys.filter((_, i) => i !== action.index) };
    case "ADD_SERIES":
      return { ...state, series: [...state.series, { measureType: "count", measureProperty: "", eventFilter: "" }] };
    case "UPDATE_SERIES":
      return { ...state, series: state.series.map((s, i) => (i === action.index ? { ...s, ...action.patch } : s)) };
    case "REMOVE_SERIES":
      return { ...state, series: state.series.filter((_, i) => i !== action.index) };
  }
}

// ─── Query Builder ─────────────────────────────────────────────────────────────

function buildQueryFromState(state: ConfigState): InsightQuery | null {
  if (state.type === "funnel") {
    if (state.funnelSteps.length < 2) return null;
    return { measure: "count", funnelSteps: state.funnelSteps };
  }

  if (state.type === "retention") {
    return {
      measure: "count",
      retentionPeriod: state.retentionPeriod,
      retentionPeriods: state.retentionPeriods,
    };
  }

  const measure: InsightQuery["measure"] = CUSTOM_AGGS.has(state.measureType)
    ? { property: state.measureProperty, aggregation: state.measureType as "sum" | "avg" | "min" | "max" }
    : state.measureType as "count" | "unique_sessions" | "unique_users";

  if (CUSTOM_AGGS.has(state.measureType) && !state.measureProperty) return null;
  if (state.type === "breakdown" && state.groupByKeys.filter(Boolean).length === 0) return null;

  const query: InsightQuery = { measure };

  if (state.eventFilter) {
    query.eventFilter = { names: [state.eventFilter] };
  }

  const validFilters = state.propFilters.filter((f) => f.field && f.value);
  if (validFilters.length > 0) {
    query.eventFilter = {
      ...query.eventFilter,
      properties: validFilters.map((f) => ({
        ...f,
        field: f.field.startsWith("prop:") ? f.field.slice(5) : f.field,
      })),
    };
  }

  if (state.type === "timeseries") {
    query.timeBucket = state.timeBucket;
    // Extra series: include only fully-configured rows so a half-built row
    // doesn't break the insight. Shared property filters apply to every series.
    const series = state.series
      .filter((s) => !CUSTOM_AGGS.has(s.measureType) || s.measureProperty)
      .map((s) => {
        const measure: InsightQuery["measure"] = CUSTOM_AGGS.has(s.measureType)
          ? { property: s.measureProperty, aggregation: s.measureType as "sum" | "avg" | "min" | "max" }
          : s.measureType as "count" | "unique_sessions" | "unique_users";
        const eventFilter: InsightQuery["eventFilter"] = {};
        if (s.eventFilter) eventFilter.names = [s.eventFilter];
        if (validFilters.length > 0) eventFilter.properties = query.eventFilter?.properties;
        return { measure, ...(eventFilter.names || eventFilter.properties ? { eventFilter } : {}) };
      });
    if (series.length > 0) query.series = series;
  }

  if (state.type === "breakdown") {
    const keys = state.groupByKeys.filter(Boolean);
    query.groupBy = keys.map((k) =>
      k.startsWith("prop:")
        ? { type: "property", key: k.slice(5) }
        : { type: "system", key: k },
    );
    query.orderBy = { field: "value", direction: "desc" };
    query.limit = state.limit;
  }

  return query;
}

function rowLabel(measureType: string, measureProperty: string, eventFilter: string): string {
  if (eventFilter) return eventFilter;
  return CUSTOM_AGGS.has(measureType)
    ? `${measureType} of ${measureProperty || "..."}`
    : measureType === "count" ? "Events"
    : measureType === "unique_sessions" ? "Sessions"
    : "Users";
}

function autoTitle(state: ConfigState): string {
  const measureLabel = CUSTOM_AGGS.has(state.measureType)
    ? `${state.measureType} of ${state.measureProperty || "..."}`
    : state.measureType === "count" ? "Events"
    : state.measureType === "unique_sessions" ? "Sessions"
    : "Users";

  if (state.type === "timeseries" && state.series.length > 0) {
    const labels = [
      rowLabel(state.measureType, state.measureProperty, state.eventFilter),
      ...state.series.map((s) => rowLabel(s.measureType, s.measureProperty, s.eventFilter)),
    ];
    return labels.join(" vs ");
  }

  const gbKeys = state.groupByKeys.filter(Boolean);
  if (state.type === "breakdown" && gbKeys.length) {
    const labels = gbKeys.map((gk) => {
      const key = gk.startsWith("prop:") ? gk.slice(5) : gk;
      return SYSTEM_GROUP_BY.find((g) => g.value === key)?.label ?? key;
    });
    return `${measureLabel} by ${labels.join(" and ")}`;
  }

  if (state.type === "timeseries") return `${measureLabel} over time`;

  return `Total ${measureLabel.toLowerCase()}`;
}

// ─── Schema ────────────────────────────────────────────────────────────────────

type ProjectSchema = {
  eventNames: { name: string; count: number }[];
  propKeys: string[];
  numericPropKeys: string[];
  systemFields: { osNames: string[]; locales: string[]; appVersions: string[] };
};

// ─── Component ─────────────────────────────────────────────────────────────────

type Props = {
  initialInsight: Insight;
  projects: { id: string; name: string }[];
  projectId: string; // the dashboard's current project — the default for an insight without its own
  timeRange: TimeRange;
  onConfigChange: (insight: Partial<Insight> & { query: InsightQuery }) => void;
  onDismiss: () => void;
};

function initState(insight: Insight, defaultProjectId: string): ConfigState {
  const q = insight.query;
  const isCustomAgg = q?.measure && typeof q.measure === "object";

  return {
    title: insight.title,
    type: insight.type,
    projectId: insight.projectId ?? defaultProjectId,
    measureType: isCustomAgg ? (q!.measure as { aggregation: string }).aggregation : (q?.measure as string) ?? "count",
    measureProperty: isCustomAgg ? (q!.measure as { property: string }).property : "",
    eventFilter: q?.eventFilter?.names?.[0] ?? "",
    series: (q?.series ?? []).map((s) => {
      const custom = typeof s.measure === "object";
      return {
        measureType: custom ? (s.measure as { aggregation: string }).aggregation : (s.measure as string),
        measureProperty: custom ? (s.measure as { property: string }).property : "",
        eventFilter: s.eventFilter?.names?.[0] ?? "",
      };
    }),
    groupByKeys: (() => {
      const keys = (q?.groupBy ?? [])
        .map((g) => (g.type === "property" ? `prop:${g.key}` : g.type === "system" ? g.key : ""))
        .filter(Boolean);
      return keys.length ? keys : insight.type === "breakdown" ? [""] : [];
    })(),
    timeBucket: (q?.timeBucket as ConfigState["timeBucket"]) ?? "day",
    limit: q?.limit ?? 10,
    propFilters: q?.eventFilter?.properties ?? [],
    funnelSteps: q?.funnelSteps ?? [],
    retentionPeriod: q?.retentionPeriod ?? "week",
    retentionPeriods: q?.retentionPeriods ?? 8,
  };
}

export function InsightConfigurator({ initialInsight, projects, projectId: dashboardProjectId, timeRange, onConfigChange, onDismiss }: Props) {
  // Fall back to the dashboard's current project (not an arbitrary projects[0])
  // for an insight that has no projectId of its own.
  const [state, dispatch] = useReducer(reducer, initState(initialInsight, dashboardProjectId || projects[0]?.id || ""));

  const [schema, setSchema] = React.useState<ProjectSchema | null>(null);
  const [previewData, setPreviewData] = React.useState<Insight["data"] | null>(null);
  const [previewMeta, setPreviewMeta] = React.useState<{ totalEvents: number; executionMs: number } | undefined>();
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const query = buildQueryFromState(state);
  const isIncomplete = query === null;
  const displayTitle = state.title || autoTitle(state);

  // Fetch schema when project changes
  useEffect(() => {
    if (!state.projectId) return;
    fetch(`/api/v0/projects/${state.projectId}/schema`)
      .then((r) => r.json())
      .then(setSchema)
      .catch(() => setSchema(null));
  }, [state.projectId]);

  // Preview query (300ms debounce)
  useEffect(() => {
    if (isIncomplete) {
      setPreviewData(null);
      setPreviewError(null);
      return;
    }

    const timer = setTimeout(async () => {
      // Retention preview: placeholder, skip live query
      if (state.type === "retention") {
        setPreviewData({ cohorts: [], periods: [] });
        setPreviewLoading(false);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPreviewLoading(true);
      setPreviewError(null);

      try {
        const res = await fetch("/api/v0/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: state.projectId, query, timeRange }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error("Query failed");

        const { data, meta } = await res.json();
        // Funnels and multi-series timeseries come back already shaped
        // ({ steps } / { labels, values, series }); everything else is rows.
        const preShaped = state.type === "funnel"
          || (state.type === "timeseries" && (query?.series?.length ?? 0) > 0);
        setPreviewData(
          preShaped
            ? data
            : mapQueryResultToInsightData(state.type as "metric" | "timeseries" | "breakdown", data),
        );
        setPreviewMeta(meta);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setPreviewError("Query failed");
        setPreviewData(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [state.type, state.projectId, state.measureType, state.measureProperty, state.eventFilter, state.series, state.groupByKeys, state.timeBucket, state.limit, state.propFilters, state.funnelSteps, isIncomplete, timeRange]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-persist (800ms debounce)
  useEffect(() => {
    if (isIncomplete) return;

    clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      onConfigChange({
        title: displayTitle,
        type: state.type,
        span: state.type === "metric" ? 1 : 2,
        query: query!,
        projectId: state.projectId,
      });
    }, 800);

    return () => clearTimeout(persistTimerRef.current);
  }, [state, displayTitle, isIncomplete]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape key to dismiss
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  const set = useCallback((field: keyof ConfigState, value: unknown) => {
    dispatch({ type: "SET", field, value });
  }, []);

  const groupByOptions = [
    ...SYSTEM_GROUP_BY,
    ...(schema?.propKeys ?? []).map((k) => ({ value: `prop:${k}`, label: k, detail: "prop" })),
  ];

  return (
    <div className="w-full bg-surface-1 border border-accent/30 rounded-lg overflow-hidden">
      {/* Config controls */}
      <div className="p-5 space-y-3">
        {/* Title — labelled + pencil so it reads as an editable field. */}
        <label className="group flex items-center gap-2 rounded-md border border-border bg-surface-2/60 px-2.5 py-1.5 focus-within:border-accent/60 focus-within:bg-surface-2 transition-colors cursor-text">
          <Pencil className="w-3.5 h-3.5 text-text-tertiary group-focus-within:text-accent shrink-0" />
          <input
            type="text"
            value={state.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder={`${autoTitle(state)}  —  click to rename`}
            className="w-full text-sm font-medium bg-transparent text-text-primary placeholder:text-text-tertiary placeholder:font-normal focus:outline-none"
          />
        </label>

        {/* Project */}
        {projects.length > 1 && (
          <ConfigSection label="Project">
            <Dropdown
              value={state.projectId}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(v) => set("projectId", v)}
            />
          </ConfigSection>
        )}

        {/* Type */}
        <ConfigSection label="Type">
          <TypePicker value={state.type} onChange={(v) => set("type", v)} />
        </ConfigSection>

        {/* Measure (not for funnel/retention) */}
        {state.type !== "funnel" && state.type !== "retention" && (
          <ConfigSection label="Measure">
            <MeasurePicker
              measureType={state.measureType}
              measureProperty={state.measureProperty}
              propKeys={schema?.numericPropKeys ?? []}
              onMeasureTypeChange={(v) => set("measureType", v)}
              onMeasurePropertyChange={(v) => set("measureProperty", v)}
            />
          </ConfigSection>
        )}

        {/* Event filter (not for retention) */}
        {schema && schema.eventNames.length > 0 && state.type !== "retention" && (
          <ConfigSection label="Event">
            <EventFilter
              value={state.eventFilter}
              events={schema.eventNames}
              onChange={(v) => set("eventFilter", v)}
            />
          </ConfigSection>
        )}

        {/* Group by (breakdown only) — one or more properties */}
        {state.type === "breakdown" && (
          <ConfigSection label="Group by">
            <div className="space-y-2">
              {state.groupByKeys.map((gk, i) => {
                // Don't offer a property already chosen in another row.
                const taken = new Set(state.groupByKeys.filter((_, j) => j !== i).filter(Boolean));
                const opts = groupByOptions.filter((o) => !taken.has(o.value));
                return (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <Dropdown
                        value={gk}
                        options={opts}
                        onChange={(v) => dispatch({ type: "UPDATE_GROUP_BY", index: i, value: v })}
                        placeholder="Select field..."
                      />
                    </div>
                    {state.groupByKeys.length > 1 && (
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "REMOVE_GROUP_BY", index: i })}
                        className="shrink-0 text-text-tertiary hover:text-text-primary transition-colors p-1"
                        aria-label="Remove group-by property"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {state.groupByKeys.every(Boolean) && state.groupByKeys.length < groupByOptions.length && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: "ADD_GROUP_BY" })}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  + Add property
                </button>
              )}
            </div>
          </ConfigSection>
        )}

        {/* Time bucket (timeseries only) */}
        {state.type === "timeseries" && (
          <ConfigSection label="Granularity">
            <TimeBucketPicker
              value={state.timeBucket}
              onChange={(v) => set("timeBucket", v)}
            />
          </ConfigSection>
        )}

        {/* Extra series (timeseries only) — plot more metrics on the same chart */}
        {state.type === "timeseries" && (
          <ConfigSection label="Compare with">
            <div className="space-y-2">
              {state.series.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <MeasurePicker
                      measureType={s.measureType}
                      measureProperty={s.measureProperty}
                      propKeys={schema?.numericPropKeys ?? []}
                      onMeasureTypeChange={(v) => dispatch({ type: "UPDATE_SERIES", index: i, patch: { measureType: v } })}
                      onMeasurePropertyChange={(v) => dispatch({ type: "UPDATE_SERIES", index: i, patch: { measureProperty: v } })}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <EventFilter
                      value={s.eventFilter}
                      events={schema?.eventNames ?? []}
                      onChange={(v) => dispatch({ type: "UPDATE_SERIES", index: i, patch: { eventFilter: v } })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "REMOVE_SERIES", index: i })}
                    className="shrink-0 text-text-tertiary hover:text-text-primary transition-colors p-1"
                    aria-label="Remove series"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {state.series.length < 4 && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: "ADD_SERIES" })}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  + Add metric
                </button>
              )}
            </div>
          </ConfigSection>
        )}

        {/* Limit (breakdown only) */}
        {state.type === "breakdown" && (
          <ConfigSection label="Limit">
            <input
              type="number"
              value={state.limit}
              onChange={(e) => set("limit", parseInt(e.target.value) || 10)}
              min={1}
              max={50}
              className="w-20 px-2.5 py-1.5 text-xs bg-surface-2 border border-border rounded-md text-text-primary focus:outline-none focus:border-accent/60"
            />
          </ConfigSection>
        )}

        {/* Funnel steps */}
        {state.type === "funnel" && schema && (
          <ConfigSection label="Steps (min 2)">
            <div className="space-y-1.5">
              {state.funnelSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-xs text-text-tertiary w-4 tabular-nums">{i + 1}</span>
                  <span className="flex-1 text-xs text-text-primary bg-surface-2 px-2.5 py-1.5 rounded-md border border-border">{step}</span>
                  <button
                    onClick={() => dispatch({ type: "REMOVE_FUNNEL_STEP", index: i })}
                    className="p-1 text-text-tertiary hover:text-error transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <Dropdown
                value=""
                options={schema.eventNames
                  .filter((e) => !state.funnelSteps.includes(e.name))
                  .map((e) => ({ value: e.name, label: e.name, detail: String(e.count) }))}
                onChange={(v) => dispatch({ type: "ADD_FUNNEL_STEP", step: v })}
                placeholder="Add step..."
              />
            </div>
          </ConfigSection>
        )}

        {/* Retention config */}
        {state.type === "retention" && (
          <>
            <ConfigSection label="Period">
              <div className="flex gap-1.5">
                {(["day", "week", "month"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => set("retentionPeriod", p)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      state.retentionPeriod === p
                        ? "bg-accent/15 text-accent border border-accent/30"
                        : "bg-surface-2 text-text-secondary border border-transparent hover:text-text-primary"
                    }`}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </ConfigSection>
            <ConfigSection label="Cohorts">
              <input
                type="number"
                value={state.retentionPeriods}
                onChange={(e) => set("retentionPeriods", Math.max(2, Math.min(12, parseInt(e.target.value) || 8)))}
                min={2}
                max={12}
                className="w-20 px-2.5 py-1.5 text-xs bg-surface-2 border border-border rounded-md text-text-primary focus:outline-none focus:border-accent/60"
              />
            </ConfigSection>
          </>
        )}

        {/* Property filters */}
        {schema && state.type !== "funnel" && state.type !== "retention" && (
          <ConfigSection label="Filters">
            <PropertyFilters
              filters={state.propFilters}
              propKeys={schema.propKeys}
              systemFields={schema.systemFields}
              onAdd={() => dispatch({ type: "ADD_FILTER" })}
              onUpdate={(i, f) => dispatch({ type: "UPDATE_FILTER", index: i, filter: f })}
              onRemove={(i) => dispatch({ type: "REMOVE_FILTER", index: i })}
            />
          </ConfigSection>
        )}
      </div>

      {/* Preview */}
      <div className="border-t border-border px-5 py-3 bg-surface-0/50">
        <LivePreview
          type={state.type}
          data={previewData}
          loading={previewLoading}
          error={previewError}
          incomplete={isIncomplete}
          meta={previewMeta}
        />
      </div>

      {/* Done */}
      <div className="border-t border-border px-5 py-2 flex justify-end">
        <button
          onClick={onDismiss}
          className="px-3 py-1 text-xs text-accent hover:text-accent-hover transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// Need React import for useState calls
import React from "react";
