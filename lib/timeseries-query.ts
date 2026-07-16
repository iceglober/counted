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

type Granularity = "hour" | "day" | "week" | "month";

/** Resolve the requested time range to concrete [start, end] Date bounds. */
function resolveRangeBounds(timeRange: TimeRange): { start: Date; end: Date } {
  if (timeRange.type === "absolute") {
    return { start: new Date(timeRange.start), end: new Date(timeRange.end) };
  }
  const end = new Date();
  const start = new Date(end);
  switch (timeRange.unit) {
    case "hours":
      start.setUTCHours(start.getUTCHours() - timeRange.value);
      break;
    case "weeks":
      start.setUTCDate(start.getUTCDate() - timeRange.value * 7);
      break;
    case "months":
      start.setUTCMonth(start.getUTCMonth() - timeRange.value);
      break;
    case "days":
    default:
      start.setUTCDate(start.getUTCDate() - timeRange.value);
      break;
  }
  return { start, end };
}

/** Truncate a date to the start of its bucket, matching Postgres time_bucket alignment (UTC). */
function truncToBucket(d: Date, bucket: Granularity): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (bucket === "hour") return new Date(Date.UTC(y, m, day, d.getUTCHours()));
  if (bucket === "day") return new Date(Date.UTC(y, m, day));
  if (bucket === "week") {
    // Align to Monday (time_bucket's default origin, 2000-01-03, is a Monday).
    const base = new Date(Date.UTC(y, m, day));
    const dow = (base.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    base.setUTCDate(base.getUTCDate() - dow);
    return base;
  }
  return new Date(Date.UTC(y, m, 1)); // month
}

/** Advance a bucket-start date by one bucket. */
function stepBucket(d: Date, bucket: Granularity): Date {
  const next = new Date(d);
  if (bucket === "hour") next.setUTCHours(next.getUTCHours() + 1);
  else if (bucket === "day") next.setUTCDate(next.getUTCDate() + 1);
  else if (bucket === "week") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/**
 * Every bucket key (ISO string) expected across [start, end] at the given
 * granularity, so a range with data in only one bucket still yields a full axis
 * (a new project with all events today gets a zero-filled line rather than the
 * single-point "No data yet" empty state).
 */
function expectedBucketKeys(timeRange: TimeRange, bucket: Granularity): string[] {
  const { start, end } = resolveRangeBounds(timeRange);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

  const keys: string[] = [];
  let cursor = truncToBucket(start, bucket);
  const last = truncToBucket(end, bucket);
  // Guard against pathological ranges producing a runaway loop.
  for (let i = 0; cursor <= last && i < 10_000; i++) {
    keys.push(cursor.toISOString());
    cursor = stepBucket(cursor, bucket);
  }
  return keys;
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

  const granularity: Granularity = query.timeBucket ?? "day";

  // Seed the axis with every expected bucket across the requested range so a
  // project with data in only one bucket still renders a full, zero-filled line
  // (avoids the single-point "No data yet" empty state). A genuinely empty range
  // still yields all-zero buckets, which the card treats as an empty state.
  const bucketKeys = new Set<string>(expectedBucketKeys(timeRange, granularity));
  const perSeries = results.map((r) => {
    const map = new Map<string, number>();
    for (const row of r.rows as { bucket: string | Date; value: unknown }[]) {
      const key = new Date(row.bucket).toISOString();
      map.set(key, Number(row.value) || 0);
      // Real data outside the computed window (edge rounding) still shows up.
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
