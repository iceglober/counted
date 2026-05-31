"use client";

import { useState, useEffect } from "react";
import type { InsightQuery } from "@/lib/types";
import { Dropdown } from "@/components/dropdown";

const MEASURES = [
  { value: "count", label: "Total events" },
  { value: "unique_sessions", label: "Unique sessions" },
  { value: "unique_users", label: "Unique users" },
];

const SYSTEM_GROUP_BY = [
  { value: "event_name", label: "Event name" },
  { value: "os_name", label: "Operating system" },
  { value: "os_version", label: "OS version" },
  { value: "locale", label: "Locale" },
  { value: "app_version", label: "App version" },
  { value: "device_model", label: "Device model" },
];

const TIME_BUCKETS = [
  { value: "hour", label: "Hourly" },
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

const INSIGHT_TYPES = [
  { value: "metric", label: "Metric" },
  { value: "timeseries", label: "Time series" },
  { value: "breakdown", label: "Breakdown" },
] as const;

type ProjectSchema = {
  eventNames: { name: string; count: number }[];
  propKeys: string[];
  systemFields: {
    osNames: string[];
    locales: string[];
    appVersions: string[];
  };
};

type ProjectOption = { id: string; name: string };

type Props = {
  initialTitle: string;
  initialType: "metric" | "timeseries" | "breakdown";
  initialQuery?: InsightQuery;
  initialProjectId?: string;
  projects: ProjectOption[];
  onSave: (config: { title: string; type: "metric" | "timeseries" | "breakdown"; query: InsightQuery; projectId: string }) => void;
  onCancel: () => void;
};

export function InsightConfigurator({ initialTitle, initialType, initialQuery, initialProjectId, projects, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [type, setType] = useState(initialType);
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "");
  const [measure, setMeasure] = useState<"count" | "unique_sessions" | "unique_users">(
    typeof initialQuery?.measure === "string" ? initialQuery.measure as "count" | "unique_sessions" | "unique_users" : "count",
  );
  const [groupBy, setGroupBy] = useState(
    initialQuery?.groupBy?.[0]?.type === "system" ? initialQuery.groupBy[0].key : "",
  );
  const [propGroupBy, setPropGroupBy] = useState(
    initialQuery?.groupBy?.[0]?.type === "property" ? initialQuery.groupBy[0].key : "",
  );
  const [groupByType, setGroupByType] = useState<"system" | "property">(
    initialQuery?.groupBy?.[0]?.type === "property" ? "property" : "system",
  );
  const [timeBucket, setTimeBucket] = useState<"hour" | "day" | "week" | "month">(
    (initialQuery?.timeBucket as "hour" | "day" | "week" | "month") ?? "day",
  );
  const [limit, setLimit] = useState(initialQuery?.limit ?? 10);
  const [eventFilter, setEventFilter] = useState(initialQuery?.eventFilter?.names?.[0] ?? "");

  const [schema, setSchema] = useState<ProjectSchema | null>(null);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/v0/projects/${projectId}/schema`)
      .then((r) => r.json())
      .then(setSchema)
      .catch(() => {});
  }, [projectId]);

  const groupByOptions = [
    ...SYSTEM_GROUP_BY,
    ...(schema?.propKeys ?? []).map((k) => ({ value: `prop:${k}`, label: k, detail: "prop" })),
  ];

  const selectedGroupBy = groupByType === "property" ? `prop:${propGroupBy}` : groupBy;

  function handleGroupByChange(val: string) {
    if (val.startsWith("prop:")) {
      setGroupByType("property");
      setPropGroupBy(val.slice(5));
      setGroupBy("");
    } else {
      setGroupByType("system");
      setGroupBy(val);
      setPropGroupBy("");
    }
  }

  function buildQuery(): InsightQuery {
    const query: InsightQuery = { measure };

    if (eventFilter) {
      query.eventFilter = { names: [eventFilter] };
    }

    if (type === "timeseries") {
      query.timeBucket = timeBucket;
    }

    if (type === "breakdown") {
      if (groupByType === "property" && propGroupBy) {
        query.groupBy = [{ type: "property", key: propGroupBy }];
      } else if (groupBy) {
        query.groupBy = [{ type: "system", key: groupBy }];
      }
      query.orderBy = { field: "value", direction: "desc" };
      query.limit = limit;
    }

    return query;
  }

  function handleSave() {
    onSave({
      title: title || "Untitled",
      type,
      query: buildQuery(),
      projectId,
    });
  }

  return (
    <div className="w-full bg-surface-1 border border-accent/30 rounded-lg p-5 space-y-3">
      {/* Title */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Insight title"
        className="w-full text-sm font-medium bg-transparent border-b border-border pb-1 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/60"
      />

      {/* Project */}
      <div>
        <label className="text-xs text-text-tertiary uppercase tracking-wider">Project</label>
        <Dropdown
          value={projectId}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          onChange={setProjectId}
          placeholder="Select project..."
          className="mt-1.5"
        />
      </div>

      {/* Type */}
      <div>
        <label className="text-xs text-text-tertiary uppercase tracking-wider">Type</label>
        <div className="flex gap-1.5 mt-1.5">
          {INSIGHT_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                type === t.value
                  ? "bg-accent/15 text-accent border border-accent/30"
                  : "bg-surface-2 text-text-secondary border border-transparent hover:text-text-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Measure */}
      <div>
        <label className="text-xs text-text-tertiary uppercase tracking-wider">Measure</label>
        <Dropdown
          value={measure}
          options={MEASURES}
          onChange={(v) => setMeasure(v as "count" | "unique_sessions" | "unique_users")}
          className="mt-1.5"
        />
      </div>

      {/* Event filter */}
      {schema && schema.eventNames.length > 0 && (
        <div>
          <label className="text-xs text-text-tertiary uppercase tracking-wider">Event filter</label>
          <Dropdown
            value={eventFilter}
            options={[
              { value: "", label: "All events" },
              ...schema.eventNames.map((e) => ({
                value: e.name,
                label: e.name,
                detail: String(e.count),
              })),
            ]}
            onChange={setEventFilter}
            className="mt-1.5"
          />
        </div>
      )}

      {/* Group by (breakdown) */}
      {type === "breakdown" && (
        <div>
          <label className="text-xs text-text-tertiary uppercase tracking-wider">Group by</label>
          <Dropdown
            value={selectedGroupBy}
            options={groupByOptions}
            onChange={handleGroupByChange}
            placeholder="Select field..."
            className="mt-1.5"
          />
        </div>
      )}

      {/* Time bucket (timeseries) */}
      {type === "timeseries" && (
        <div>
          <label className="text-xs text-text-tertiary uppercase tracking-wider">Granularity</label>
          <div className="flex gap-1.5 mt-1.5">
            {TIME_BUCKETS.map((b) => (
              <button
                key={b.value}
                onClick={() => setTimeBucket(b.value as "hour" | "day" | "week" | "month")}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  timeBucket === b.value
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "bg-surface-2 text-text-secondary border border-transparent hover:text-text-primary"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Limit (breakdown) */}
      {type === "breakdown" && (
        <div>
          <label className="text-xs text-text-tertiary uppercase tracking-wider">Limit</label>
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
            min={1}
            max={50}
            className="mt-1.5 w-20 px-2.5 py-1.5 text-xs bg-surface-2 border border-border rounded-md text-text-primary focus:outline-none focus:border-accent/60"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-border">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-3 py-1.5 text-xs text-surface-0 bg-accent rounded-md hover:bg-accent-hover transition-colors font-medium"
        >
          Save
        </button>
      </div>
    </div>
  );
}
