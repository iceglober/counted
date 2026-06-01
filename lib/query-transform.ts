import type { InsightType, Insight, MetricData, TimeSeriesData, BreakdownItem } from "./types";

function formatBucketLabel(bucket: string | Date): string {
  const d = bucket instanceof Date ? bucket : new Date(bucket);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function mapQueryResultToInsightData(
  type: InsightType,
  rows: Record<string, unknown>[],
): Insight["data"] {
  switch (type) {
    case "metric": {
      const value = rows[0]?.value ?? 0;
      return {
        value: Number(value).toLocaleString("en-US"),
        trend: 0,
        sparkline: [],
      } satisfies MetricData;
    }
    case "timeseries": {
      return {
        labels: rows.map((r) => formatBucketLabel(r.bucket as string)),
        values: rows.map((r) => Number(r.value)),
      } satisfies TimeSeriesData;
    }
    case "breakdown": {
      const labelKey = Object.keys(rows[0] ?? {}).find((k) => k !== "value") ?? "label";
      return {
        items: rows.map((r) => ({
          label: String(r[labelKey] ?? "unknown"),
          value: Number(r.value),
        })),
      } satisfies { items: BreakdownItem[] };
    }
    case "funnel":
      return { steps: [] };
    case "retention":
      return { cohorts: [], periods: [] };
  }
}
