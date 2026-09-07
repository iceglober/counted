/**
 * How many events a workspace has recorded this period.
 *
 * **Counted from the event store, not from a counter.** There is no usage
 * table, and adding one would be adding a second answer to a question the
 * events already answer — a counter that drifts is worse than a query that
 * costs something, because nothing tells you it has drifted. litics aggregates
 * a workspace scope across its whole project subtree, so this is one indexed read
 * rather than a fan-out.
 *
 * The period is the calendar month to date, in UTC, because the limit it is
 * compared against is `eventsPerMonth`. A billing anniversary would be more
 * accurate for a paying customer and is the obvious next version; it needs the
 * subscription's period start, which `Subscription` carries as `renewsAt` and
 * nothing carries as a *start*. Stated here rather than approximated silently.
 */

import { Instant, type WorkspaceId } from "@counted/kernel";
import type { AnalyticsEngine, Bounds, EngineFailure, QueryOptions } from "@counted/analytics-ports";

export type Period = Bounds;

/** First instant of the UTC month containing `at`, through `at`. */
export const monthToDate = (at: Instant): Period => {
  const date = new Date(Instant.toEpochMillis(at));
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0);
  return { from: Instant.fromEpochMillis(start), to: at };
};

export type UsageReading =
  | { readonly ok: true; readonly events: number }
  | { readonly ok: false; readonly failure: EngineFailure };

export const eventsThisPeriod = async (
  engine: AnalyticsEngine,
  workspace: WorkspaceId,
  at: Instant,
  options: QueryOptions,
): Promise<UsageReading> => {
  const outcome = await engine.counts(
    { scope: { level: "workspace", workspace }, bounds: monthToDate(at), step: "day" },
    options,
  );
  if (!outcome.ok) return { ok: false, failure: outcome.error };
  return {
    ok: true,
    events: outcome.value.buckets.reduce((sum, bucket) => sum + bucket.value, 0),
  };
};
