/**
 * `rollups.refresh` — keep the daily rollups in step with the events.
 *
 * A rollup is a second copy of data that already exists, and the only reason
 * to keep one is speed. So the bar it has to clear is that it never disagrees
 * with the source, because a fast wrong number is worse than a slow right one.
 *
 * Three things hold that up, and none of them are in this file by accident:
 *
 *   The refresh **recomputes whole buckets** rather than incrementing
 *   counters. The worker's lease guarantees this job eventually runs twice
 *   over the same window; an incremental counter would drift the first time it
 *   did, and nothing would ever notice.
 *
 *   The dirty set comes from **`ingested_at`**, not from "the last few days".
 *   The ingest contract accepts events backdated up to ninety days, so a
 *   March bucket can change in June. A trailing-window refresh misses that
 *   silently — which is the failure mode that makes people distrust rollups.
 *
 *   The watermark advances **only after the refresh commits**. If the refresh
 *   fails, the window is retried rather than skipped; the cost of doing a
 *   window twice is nothing, and the cost of skipping one is a permanently
 *   wrong number.
 */

import { Duration, Instant } from "@counted/domain";
import type { RollupMaintenance } from "@counted/ports";
import type { Handler } from "../runtime";

/**
 * The most ingestion time one run will cover.
 *
 * Bounded on ingestion time rather than on row count so the watermark can
 * always advance to a known instant. A row limit would leave the window half
 * done with nowhere honest to put the watermark.
 */
export const MAX_WINDOW = Duration.hours(6);

export const rollupsRefresh = (rollups: RollupMaintenance): Handler => async (_job, context) => {
  const watermark = await rollups.watermark();

  // Never run: everything so far, in one pass. This is the only unbounded
  // case, and it happens once on an empty database.
  const from = watermark;
  const ceiling = from === null ? context.now : Instant.min(context.now, Instant.plus(from, MAX_WINDOW));

  if (from !== null && Instant.toEpochMillis(ceiling) <= Instant.toEpochMillis(from)) {
    // The clock has not moved past the watermark. Nothing to do, and advancing
    // would move it backwards.
    return { kind: "noop", detail: "watermark is current" };
  }

  const buckets = await rollups.refresh(from, ceiling);

  // Only now. A failure above leaves the watermark where it was, so the window
  // is retried rather than skipped.
  await rollups.commitWatermark(ceiling);

  const caughtUp = Instant.toEpochMillis(ceiling) >= Instant.toEpochMillis(context.now);
  if (buckets === 0) {
    return { kind: "noop", detail: caughtUp ? "no events since the last refresh" : "empty window" };
  }

  context.log.info("rollups.refreshed", {
    buckets,
    from: from === null ? null : Instant.toISO(from),
    to: Instant.toISO(ceiling),
    caughtUp,
  });

  return {
    kind: "done",
    detail: `${buckets} buckets recomputed${caughtUp ? "" : " (behind, more windows remain)"}`,
  };
};
