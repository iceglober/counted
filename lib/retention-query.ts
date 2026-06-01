import { pool } from "./db";
import type { TimeRange, RetentionData } from "./types";

function timeRangeToSql(timeRange: TimeRange, params: unknown[]): string {
  if (timeRange.type === "relative") {
    params.push(timeRange.value);
    const unitMap: Record<string, string> = { hours: "hours", days: "days", weeks: "weeks", months: "months" };
    const unit = unitMap[timeRange.unit] ?? "days";
    return `timestamp >= NOW() - make_interval(${unit} => $${params.length})`;
  }
  params.push(timeRange.start);
  params.push(timeRange.end);
  return `timestamp >= $${params.length - 1}::timestamptz AND timestamp <= $${params.length}::timestamptz`;
}

export async function executeRetentionQuery(
  projectId: string,
  timeRange: TimeRange,
  period: "day" | "week" | "month" = "week",
  numPeriods: number = 8,
): Promise<RetentionData> {
  const params: unknown[] = [projectId];
  const timeCondition = timeRangeToSql(timeRange, params);

  // 1. Find the first activity period for each session
  // 2. For each cohort (first-activity period), count how many sessions
  //    were also active in subsequent periods
  const sql = `
    WITH session_first AS (
      SELECT session_id, date_trunc($${params.length + 1}, MIN(timestamp)) AS first_period
      FROM events
      WHERE project_id = $1 AND ${timeCondition}
      GROUP BY session_id
    ),
    session_activity AS (
      SELECT DISTINCT session_id, date_trunc($${params.length + 1}, timestamp) AS activity_period
      FROM events
      WHERE project_id = $1 AND ${timeCondition}
    ),
    cohorts AS (
      SELECT
        sf.first_period,
        sa.activity_period,
        COUNT(DISTINCT sf.session_id) AS active_count
      FROM session_first sf
      JOIN session_activity sa ON sf.session_id = sa.session_id
      GROUP BY sf.first_period, sa.activity_period
      ORDER BY sf.first_period, sa.activity_period
    ),
    cohort_sizes AS (
      SELECT first_period, COUNT(*) AS size
      FROM session_first
      GROUP BY first_period
    )
    SELECT
      c.first_period,
      cs.size AS cohort_size,
      c.activity_period,
      c.active_count
    FROM cohorts c
    JOIN cohort_sizes cs ON c.first_period = cs.first_period
    ORDER BY c.first_period, c.activity_period
  `;

  params.push(period);

  const result = await pool.query(sql, params);

  // Group rows by cohort
  const cohortMap = new Map<string, { size: number; periods: Map<string, number> }>();

  for (const row of result.rows) {
    const firstPeriod = new Date(row.first_period as string).toISOString();
    const activityPeriod = new Date(row.activity_period as string).toISOString();

    if (!cohortMap.has(firstPeriod)) {
      cohortMap.set(firstPeriod, {
        size: Number(row.cohort_size),
        periods: new Map(),
      });
    }
    cohortMap.get(firstPeriod)!.periods.set(activityPeriod, Number(row.active_count));
  }

  // Convert to sorted cohorts, limit to numPeriods
  const sortedCohorts = [...cohortMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-numPeriods);

  // Collect all unique periods across all cohorts for period labels
  const allPeriods = new Set<string>();
  for (const [, data] of sortedCohorts) {
    for (const p of data.periods.keys()) {
      allPeriods.add(p);
    }
  }
  const sortedPeriods = [...allPeriods].sort();

  const periodLabels = Array.from({ length: numPeriods }, (_, i) =>
    i === 0 ? `${period} 0` : `+${i}`,
  );

  const cohorts = sortedCohorts.map(([firstPeriod, data]) => {
    const firstIdx = sortedPeriods.indexOf(firstPeriod);
    const retention: number[] = [];

    for (let i = 0; i < numPeriods; i++) {
      const targetPeriod = sortedPeriods[firstIdx + i];
      if (!targetPeriod) {
        break;
      }
      const active = data.periods.get(targetPeriod) ?? 0;
      retention.push(data.size > 0 ? Math.round((active / data.size) * 1000) / 10 : 0);
    }

    return {
      label: formatPeriodLabel(firstPeriod, period),
      size: data.size,
      retention,
    };
  });

  return { cohorts, periods: periodLabels };
}

function formatPeriodLabel(iso: string, period: "day" | "week" | "month"): string {
  const d = new Date(iso);
  if (period === "month") {
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
