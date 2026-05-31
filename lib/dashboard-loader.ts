import { db, pool } from "./db";
import { dashboards } from "./db/schema";
import { eq, and } from "drizzle-orm";
import { buildQuery } from "./query-engine";
import type {
  Insight, MetricData, TimeSeriesData,
  BreakdownItem, InsightLayout, TimeRange,
} from "./types";

function formatBucketLabel(bucket: string | Date): string {
  const d = bucket instanceof Date ? bucket : new Date(bucket);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function computePreviousTimeRange(timeRange: TimeRange): TimeRange {
  if (timeRange.type === "relative") {
    return {
      type: "absolute",
      start: new Date(Date.now() - timeRange.value * 2 * unitToMs(timeRange.unit)).toISOString(),
      end: new Date(Date.now() - timeRange.value * unitToMs(timeRange.unit)).toISOString(),
    };
  }
  const start = new Date(timeRange.start).getTime();
  const end = new Date(timeRange.end).getTime();
  const duration = end - start;
  return {
    type: "absolute",
    start: new Date(start - duration).toISOString(),
    end: new Date(start).toISOString(),
  };
}

function unitToMs(unit: string): number {
  switch (unit) {
    case "hours": return 3_600_000;
    case "days": return 86_400_000;
    case "weeks": return 604_800_000;
    case "months": return 2_592_000_000;
    default: return 86_400_000;
  }
}

function mapQueryResultToInsightData(
  insight: InsightLayout,
  rows: Record<string, unknown>[],
): Insight["data"] {
  switch (insight.type) {
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
  }
}

function extractInsightLayouts(layout: Record<string, unknown>): InsightLayout[] {
  // Flat layout: { insights: [...] }
  if (Array.isArray(layout.insights)) {
    return layout.insights;
  }
  // Legacy sectioned layout: { sections: [{ insights/widgets: [...] }] }
  if (Array.isArray(layout.sections)) {
    return (layout.sections as Record<string, unknown>[]).flatMap((section) => {
      const items = section.insights ?? section.widgets;
      return Array.isArray(items) ? items as InsightLayout[] : [];
    });
  }
  return [];
}

export async function loadDashboardData(
  projectId: string,
  timeRange: TimeRange,
  specificDashboardId?: string,
): Promise<{ insights: Insight[]; dashboardId: string | null }> {
  const dashboard = specificDashboardId
    ? await db.query.dashboards.findFirst({
        where: eq(dashboards.id, specificDashboardId),
      })
    : await db.query.dashboards.findFirst({
        where: and(
          eq(dashboards.projectId, projectId),
          eq(dashboards.isDefault, true),
        ),
      });

  if (!dashboard || !dashboard.layout) {
    return { insights: [], dashboardId: null };
  }

  const insightLayouts = extractInsightLayouts(dashboard.layout as Record<string, unknown>);
  if (insightLayouts.length === 0) {
    return { insights: [], dashboardId: dashboard.id };
  }

  const results = await Promise.allSettled(
    insightLayouts.map(async (insight) => {
      const built = buildQuery(projectId, insight.query, timeRange);
      const result = await pool.query(built.sql, built.params);
      return result.rows;
    }),
  );

  const insights: Insight[] = insightLayouts.map((layout, i) => {
    const result = results[i];
    const rows = result.status === "fulfilled" ? result.value : [];
    return {
      id: layout.id,
      type: layout.type,
      title: layout.title,
      span: layout.span,
      data: mapQueryResultToInsightData(layout, rows),
      query: layout.query,
    };
  });

  // Enrich metric insights with sparkline and trend data
  const metricIndices = insightLayouts
    .map((layout, i) => ({ layout, i }))
    .filter(({ layout }) => layout.type === "metric");

  if (metricIndices.length > 0) {
    const enrichResults = await Promise.allSettled(
      metricIndices.flatMap(({ layout }) => {
        const sparklineQuery = {
          ...layout.query,
          timeBucket: "day" as const,
          orderBy: { field: "bucket", direction: "asc" as const },
        };
        const sparkBuilt = buildQuery(projectId, sparklineQuery, timeRange);
        const sparkPromise = pool.query(sparkBuilt.sql, sparkBuilt.params);

        const prevTimeRange = computePreviousTimeRange(timeRange);
        const prevBuilt = buildQuery(projectId, layout.query, prevTimeRange);
        const prevPromise = pool.query(prevBuilt.sql, prevBuilt.params);

        return [sparkPromise, prevPromise];
      }),
    );

    metricIndices.forEach(({ i }, idx) => {
      const sparkResult = enrichResults[idx * 2];
      const prevResult = enrichResults[idx * 2 + 1];
      const data = insights[i].data as MetricData;

      if (sparkResult.status === "fulfilled") {
        data.sparkline = sparkResult.value.rows.map((r: Record<string, unknown>) => Number(r.value));
      }

      if (prevResult.status === "fulfilled") {
        const currentValue = parseFloat(data.value.replace(/,/g, "")) || 0;
        const previousValue = Number(prevResult.value.rows[0]?.value ?? 0);
        data.trend = previousValue > 0
          ? Math.round(((currentValue - previousValue) / previousValue) * 1000) / 10
          : 0;
      }
    });
  }

  return { insights, dashboardId: dashboard.id };
}
