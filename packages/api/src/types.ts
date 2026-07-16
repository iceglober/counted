// Wire query types — the single source of truth shared by the server, the app,
// and the published @counted/api client. The app re-exports these from
// lib/types.ts; keep server-correct (includes `series` and the time-bucket
// groupBy variant the query engine accepts).

export type Measure =
  | "count"
  | "unique_sessions"
  | "unique_users"
  | { property: string; aggregation: "sum" | "avg" | "min" | "max" };

export type GroupBy =
  | { type: "property"; key: string }
  | { type: "system"; key: string }
  | { type: "time"; bucket: string };

export type PropFilter = {
  field: string;
  operator: "eq" | "neq" | "contains" | "gt" | "lt" | "in";
  value: string | number | string[];
};

/** One extra line on a timeseries insight: its own measure and event filter. */
export type SeriesQuery = {
  label?: string;
  measure: Measure;
  eventFilter?: {
    names?: string[];
    properties?: PropFilter[];
  };
};

export type InsightQuery = {
  measure: Measure;
  eventFilter?: {
    names?: string[];
    properties?: PropFilter[];
  };
  /** Additional series plotted alongside the primary measure (timeseries only). */
  series?: SeriesQuery[];
  groupBy?: GroupBy[];
  timeBucket?: "hour" | "day" | "week" | "month";
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  funnelSteps?: string[];
  retentionPeriod?: "day" | "week" | "month";
  retentionPeriods?: number;
};

export type TimeRange =
  | { type: "relative"; value: number; unit: "hours" | "days" | "weeks" | "months" }
  | { type: "absolute"; start: string; end: string };
