"use client";

import { useReducer, useEffect, useRef, useCallback } from "react";
import type { InsightQuery, Insight, PropFilter, TimeRange } from "@/lib/types";
import { mapQueryResultToInsightData } from "@/lib/query-transform";
import { Dropdown } from "@/components/dropdown";
import { ConfigSection } from "./config-section";
import { TypePicker } from "./type-picker";
import { MeasurePicker } from "./measure-picker";
import { EventFilter } from "./event-filter";
import { PropertyFilters } from "./property-filters";
import { TimeBucketPicker } from "./time-bucket-picker";
import { X } from "lucide-react";
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

type ConfigState = {
  title: string;
  type: "metric" | "timeseries" | "breakdown" | "funnel";
  projectId: string;
  measureType: string;
  measureProperty: string;
  eventFilter: string;
  groupByType: "system" | "property";
  groupByKey: string;
  timeBucket: "hour" | "day" | "week" | "month";
  limit: number;
  propFilters: PropFilter[];
  funnelSteps: string[];
};

type Action =
  | { type: "SET"; field: keyof ConfigState; value: unknown }
  | { type: "ADD_FILTER" }
  | { type: "UPDATE_FILTER"; index: number; filter: PropFilter }
  | { type: "REMOVE_FILTER"; index: number }
  | { type: "ADD_FUNNEL_STEP"; step: string }
  | { type: "REMOVE_FUNNEL_STEP"; index: number };

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
  }
}

// ─── Query Builder ─────────────────────────────────────────────────────────────

function buildQueryFromState(state: ConfigState): InsightQuery | null {
  if (state.type === "funnel") {
    if (state.funnelSteps.length < 2) return null;
    return { measure: "count", funnelSteps: state.funnelSteps };
  }

  const measure: InsightQuery["measure"] = CUSTOM_AGGS.has(state.measureType)
    ? { property: state.measureProperty, aggregation: state.measureType as "sum" | "avg" | "min" | "max" }
    : state.measureType as "count" | "unique_sessions" | "unique_users";

  if (CUSTOM_AGGS.has(state.measureType) && !state.measureProperty) return null;
  if (state.type === "breakdown" && !state.groupByKey) return null;

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
  }

  if (state.type === "breakdown" && state.groupByKey) {
    if (state.groupByKey.startsWith("prop:")) {
      query.groupBy = [{ type: "property", key: state.groupByKey.slice(5) }];
    } else {
      query.groupBy = [{ type: "system", key: state.groupByKey }];
    }
    query.orderBy = { field: "value", direction: "desc" };
    query.limit = state.limit;
  }

  return query;
}

function autoTitle(state: ConfigState): string {
  const measureLabel = CUSTOM_AGGS.has(state.measureType)
    ? `${state.measureType} of ${state.measureProperty || "..."}`
    : state.measureType === "count" ? "Events"
    : state.measureType === "unique_sessions" ? "Sessions"
    : "Users";

  if (state.type === "breakdown" && state.groupByKey) {
    const key = state.groupByKey.startsWith("prop:") ? state.groupByKey.slice(5) : state.groupByKey;
    const label = SYSTEM_GROUP_BY.find((g) => g.value === key)?.label ?? key;
    return `${measureLabel} by ${label}`;
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
    groupByType: q?.groupBy?.[0]?.type === "property" ? "property" : "system",
    groupByKey: q?.groupBy?.[0]
      ? (q.groupBy[0].type === "property" ? `prop:${q.groupBy[0].key}` : q.groupBy[0].type === "system" ? q.groupBy[0].key : "")
      : "",
    timeBucket: (q?.timeBucket as ConfigState["timeBucket"]) ?? "day",
    limit: q?.limit ?? 10,
    propFilters: q?.eventFilter?.properties ?? [],
    funnelSteps: q?.funnelSteps ?? [],
  };
}

export function InsightConfigurator({ initialInsight, projects, timeRange, onConfigChange, onDismiss }: Props) {
  const [state, dispatch] = useReducer(reducer, initState(initialInsight, projects[0]?.id ?? ""));

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
      // Funnel preview: show step count summary, skip live query
      if (state.type === "funnel") {
        setPreviewData({ steps: state.funnelSteps.map((s, i) => ({ label: s, value: 0, rate: i === 0 ? 100 : 0 })) });
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

        const { data: rows, meta } = await res.json();
        setPreviewData(mapQueryResultToInsightData(state.type as "metric" | "timeseries" | "breakdown", rows));
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
  }, [state.type, state.projectId, state.measureType, state.measureProperty, state.eventFilter, state.groupByKey, state.timeBucket, state.limit, state.propFilters, isIncomplete, timeRange]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {/* Title */}
        <input
          type="text"
          value={state.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={autoTitle(state)}
          className="w-full text-sm font-medium bg-transparent border-b border-border pb-1 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/60"
        />

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

        {/* Measure */}
        <ConfigSection label="Measure">
          <MeasurePicker
            measureType={state.measureType}
            measureProperty={state.measureProperty}
            propKeys={schema?.numericPropKeys ?? []}
            onMeasureTypeChange={(v) => set("measureType", v)}
            onMeasurePropertyChange={(v) => set("measureProperty", v)}
          />
        </ConfigSection>

        {/* Event filter */}
        {schema && schema.eventNames.length > 0 && (
          <ConfigSection label="Event">
            <EventFilter
              value={state.eventFilter}
              events={schema.eventNames}
              onChange={(v) => set("eventFilter", v)}
            />
          </ConfigSection>
        )}

        {/* Group by (breakdown only) */}
        {state.type === "breakdown" && (
          <ConfigSection label="Group by">
            <Dropdown
              value={state.groupByKey}
              options={groupByOptions}
              onChange={(v) => set("groupByKey", v)}
              placeholder="Select field..."
            />
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

        {/* Property filters */}
        {schema && state.type !== "funnel" && (
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
