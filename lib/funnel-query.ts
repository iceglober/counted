import { pool } from "./db";
import type { TimeRange, FunnelData } from "./types";

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

/**
 * Execute a funnel query — count unique sessions that performed
 * each step in sequence within the time range.
 */
export async function executeFunnelQuery(
  projectId: string,
  steps: string[],
  timeRange: TimeRange,
): Promise<FunnelData> {
  if (steps.length === 0) {
    return { steps: [] };
  }

  const params: unknown[] = [projectId];
  const timeCondition = timeRangeToSql(timeRange, params);

  // For each step, count unique sessions that have performed
  // all events up to and including that step.
  // Simple approach: for step N, count sessions that have events
  // matching ALL of steps[0..N].
  const stepQueries = steps.map((step, i) => {
    const stepsUpTo = steps.slice(0, i + 1);
    const conditions = stepsUpTo.map((s) => {
      params.push(s);
      return `EXISTS (SELECT 1 FROM events e${i}_${params.length} WHERE e${i}_${params.length}.project_id = $1 AND e${i}_${params.length}.session_id = e_base.session_id AND e${i}_${params.length}.event_name = $${params.length} AND ${timeCondition.replace(/\$1/g, `$1`)})`;
    });

    return `(SELECT COUNT(DISTINCT e_base.session_id) FROM events e_base WHERE e_base.project_id = $1 AND ${timeCondition} AND ${conditions.join(" AND ")})`;
  });

  // This gets complex with many steps. Simpler approach:
  // Query each step count independently.
  const results: FunnelData = { steps: [] };

  for (let i = 0; i < steps.length; i++) {
    const stepParams: unknown[] = [projectId];
    const stepTimeCondition = timeRangeToSql(timeRange, stepParams);

    // Count sessions that have ALL events from step 0 to step i
    let sql = `SELECT COUNT(DISTINCT session_id) as value FROM events WHERE project_id = $1 AND ${stepTimeCondition}`;

    for (let j = 0; j <= i; j++) {
      stepParams.push(steps[j]);
      sql += ` AND session_id IN (SELECT session_id FROM events WHERE project_id = $1 AND event_name = $${stepParams.length} AND ${stepTimeCondition})`;
    }

    const result = await pool.query(sql, stepParams);
    const value = Number(result.rows[0]?.value ?? 0);
    const prevValue = i > 0 ? results.steps[i - 1].value : value;
    const rate = prevValue > 0 ? (value / prevValue) * 100 : 0;

    results.steps.push({
      label: steps[i],
      value,
      rate: Math.round(rate * 10) / 10,
    });
  }

  return results;
}
