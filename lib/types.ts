// ─── Insight display types (used by dashboard components) ──────────────────────

export type MetricData = {
  value: string;
  trend: number;
  sparkline: number[];
};

export type TimeSeriesData = {
  labels: string[];
  /** Primary series values (mirrors series[0] when multiple series are present). */
  values: number[];
  /** All plotted series, in display order. Absent for legacy single-series data. */
  series?: { label: string; values: number[] }[];
};

/** How a time-series card summarises its values in the header. */
export type SummaryStat = "total" | "average" | "peak";

export type BreakdownItem = { label: string; value: number };

export type FunnelStep = { label: string; value: number; rate: number };

export type FunnelData = { steps: FunnelStep[] };

export type RetentionCohort = {
  label: string;
  size: number;
  retention: number[];
};

export type RetentionData = {
  cohorts: RetentionCohort[];
  periods: string[];
};

export type InsightType = "metric" | "timeseries" | "breakdown" | "funnel" | "retention";

export type Insight = {
  id: string;
  type: InsightType;
  title: string;
  /** Manual width in 12-col units (4=⅓, 6=½, 8=⅔, 12=full). 0/undefined = auto (row splits evenly). */
  span: number;
  /** Height in grid rows. Undefined falls back to a per-type default. */
  height?: number;
  /** Header summary for timeseries insights. Undefined = total. */
  summary?: SummaryStat;
  data: MetricData | TimeSeriesData | { items: BreakdownItem[] } | FunnelData | RetentionData;
  query?: InsightQuery;
  projectId?: string;
};

// ─── Query types (used by query engine and dashboard layout) ───────────────────

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
  | { type: "relative"; value: number; unit: string }
  | { type: "absolute"; start: string; end: string };

// ─── Dashboard layout types (stored in JSONB) ─────────────────────────────────

export type InsightLayout = {
  id: string;
  type: InsightType;
  title: string;
  span: number;
  /** Height in grid rows. Undefined falls back to a per-type default. */
  height?: number;
  /** Header summary for timeseries insights. Undefined = total. */
  summary?: SummaryStat;
  query: InsightQuery;
  projectId?: string;
};

export type DashboardLayout = {
  insights: InsightLayout[];
};
