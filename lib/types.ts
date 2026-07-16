// ─── Wire query types (single source of truth: @counted/api) ───────────────────
// Re-exported so app code keeps importing them from "@/lib/types". The server,
// the app, and the published client all share one definition — no drift.
export type {
  Measure,
  GroupBy,
  PropFilter,
  SeriesQuery,
  InsightQuery,
  TimeRange,
} from "@counted/api";

import type { InsightQuery } from "@counted/api";

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
