// ─── Insight display types (used by dashboard components) ──────────────────────

export type MetricData = {
  value: string;
  trend: number;
  sparkline: number[];
};

export type TimeSeriesData = {
  labels: string[];
  values: number[];
};

export type BreakdownItem = { label: string; value: number };

export type FunnelStep = { label: string; value: number; rate: number };

export type FunnelData = { steps: FunnelStep[] };

export type Insight = {
  id: string;
  type: "metric" | "timeseries" | "breakdown" | "funnel";
  title: string;
  span: 1 | 2 | 3 | 4;
  data: MetricData | TimeSeriesData | { items: BreakdownItem[] } | FunnelData;
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

export type InsightQuery = {
  measure: Measure;
  eventFilter?: {
    names?: string[];
    properties?: PropFilter[];
  };
  groupBy?: GroupBy[];
  timeBucket?: "hour" | "day" | "week" | "month";
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  funnelSteps?: string[];
};

export type TimeRange =
  | { type: "relative"; value: number; unit: string }
  | { type: "absolute"; start: string; end: string };

// ─── Dashboard layout types (stored in JSONB) ─────────────────────────────────

export type InsightLayout = {
  id: string;
  type: "metric" | "timeseries" | "breakdown" | "funnel";
  title: string;
  span: 1 | 2 | 3 | 4;
  query: InsightQuery;
  projectId?: string;
};

export type DashboardLayout = {
  insights: InsightLayout[];
};
