import { pool } from "./db";
import { buildQuery } from "./query-engine";
import { formatBucketLabel } from "./query-transform";
import type { InsightQuery, Measure, SeriesQuery, TimeRange, TimeSeriesData } from "./types";

function measureLabel(measure: Measure): string {
  if (measure === "count") return "Events";
  if (measure === "unique_sessions") return "Sessions";
  if (measure === "unique_users") return "Users";
  return `${measure.aggregation} of ${measure.property}`;
}

/** Display name for a series: explicit label, else its event name, else its measure. */
export function seriesLabel(s: SeriesQuery): string {
  return s.label ?? s.eventFilter?.names?.[0] ?? measureLabel(s.measure);
}

/**
 * Execute a timeseries insight query: the primary measure plus any extra
 * series in `query.series`, each as its own bucketed query, merged onto a
 * shared time axis (missing buckets are zero-filled).
 */
export async function executeTimeSeriesQuery(
  projectId: string,
  query: InsightQuery,
  timeRange: TimeRange,
): Promise<TimeSeriesData> {
  const specs: SeriesQuery[] = [
    { measure: query.measure, eventFilter: query.eventFilter },
    ...(query.series ?? []),
  ];

  const results = await Promise.all(
    specs.map((s) => {
      const built = buildQuery(projectId, {
        measure: s.measure,
        eventFilter: s.eventFilter,
        timeBucket: query.timeBucket ?? "day",
      }, timeRange);
      return pool.query(built.sql, built.params);
    }),
  );

  // Union of buckets across series, in time order.
  const bucketKeys = new Set<string>();
  const perSeries = results.map((r) => {
    const map = new Map<string, number>();
    for (const row of r.rows as { bucket: string | Date; value: unknown }[]) {
      const key = new Date(row.bucket).toISOString();
      map.set(key, Number(row.value) || 0);
      bucketKeys.add(key);
    }
    return map;
  });
  const buckets = [...bucketKeys].sort();

  const series = specs.map((s, i) => ({
    label: seriesLabel(s),
    values: buckets.map((b) => perSeries[i].get(b) ?? 0),
  }));

  return {
    labels: buckets.map((b) => formatBucketLabel(b)),
    values: series[0]?.values ?? [],
    ...(specs.length > 1 ? { series } : {}),
  };
}
