/**
 * `rollups.refresh`, over a stub.
 *
 * The SQL correctness is settled by a differential against the raw events in
 * the adapter's live tests. What is decided here is the windowing: how far one
 * run reaches, and — the part that matters — that the watermark only moves
 * after the refresh it describes has committed.
 */

import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "@counted/domain";
import type { Job, RollupMaintenance } from "@counted/ports";
import { MAX_WINDOW, rollupsRefresh } from "./rollups-refresh";

const now = Instant.fromEpochMillis(Date.parse("2026-03-17T15:00:00.000Z"));
const hoursAgo = (n: number) => Instant.minus(now, Duration.hours(n));

const job: Job = { id: "j", name: "rollups.refresh", key: "k", payload: {}, runAfter: now, attempts: 1 };

const logged: { event: string; fields?: Record<string, unknown> | undefined }[] = [];
const log = {
  info: (event: string, fields?: Record<string, unknown>) => void logged.push({ event, fields }),
  warn: () => {},
  error: () => {},
};
const context = { now, log, leaseMs: 60_000 };

const stub = (over: { watermark?: Instant | null; buckets?: number; failRefresh?: boolean } = {}) => {
  const calls: { from: Instant | null; to: Instant }[] = [];
  let committed: Instant | null = null;
  let watermark = over.watermark ?? null;

  const rollups: RollupMaintenance = {
    watermark: async () => watermark,
    refresh: async (from, to) => {
      if (over.failRefresh === true) throw new Error("statement timeout");
      calls.push({ from, to });
      return over.buckets ?? 0;
    },
    commitWatermark: async (to) => {
      committed = to;
      watermark = to;
    },
    dailyCounts: async () => [],
  };

  return { rollups, calls, committed: () => committed };
};

describe("the first run covers everything", () => {
  test("no watermark means refresh from the beginning", async () => {
    // Happens once, on an empty database. Bounding it would leave the rollup
    // permanently behind with nothing to catch it up.
    const { rollups, calls } = stub({ watermark: null, buckets: 12 });
    const outcome = await rollupsRefresh(rollups)(job, context);

    expect(calls[0]!.from).toBeNull();
    expect(calls[0]!.to).toBe(now);
    expect(outcome.kind).toBe("done");
  });

  test("it commits the watermark it actually reached", async () => {
    const { rollups, committed } = stub({ watermark: null, buckets: 1 });
    await rollupsRefresh(rollups)(job, context);
    expect(committed()).toBe(now);
  });
});

describe("later runs are bounded by ingestion time", () => {
  test("a caught-up worker refreshes up to now", async () => {
    const { rollups, calls } = stub({ watermark: hoursAgo(1), buckets: 3 });
    await rollupsRefresh(rollups)(job, context);
    expect(calls[0]!.to).toBe(now);
  });

  test("a worker far behind advances one window at a time", async () => {
    // Bounded on ingestion time rather than on rows, so the watermark can
    // always advance to a known instant. A row limit would leave the window
    // half done with nowhere honest to put it.
    const behind = hoursAgo(72);
    const { rollups, calls, committed } = stub({ watermark: behind, buckets: 500 });
    const outcome = await rollupsRefresh(rollups)(job, context);

    expect(calls[0]!.to).toBe(Instant.plus(behind, MAX_WINDOW));
    expect(committed()).toBe(Instant.plus(behind, MAX_WINDOW));
    // And it says so, rather than reading as finished.
    if (outcome.kind === "done") expect(outcome.detail).toContain("more windows remain");
  });

  test("catching up takes several runs and eventually arrives", async () => {
    const { rollups } = stub({ watermark: hoursAgo(20), buckets: 1 });
    for (let i = 0; i < 10; i++) await rollupsRefresh(rollups)(job, context);
    expect(await rollups.watermark()).toBe(now);
  });

  test("a caught-up run does not say more remain", async () => {
    const { rollups } = stub({ watermark: hoursAgo(1), buckets: 3 });
    const outcome = await rollupsRefresh(rollups)(job, context);
    if (outcome.kind === "done") expect(outcome.detail).not.toContain("more windows");
  });
});

describe("the watermark never moves backwards or ahead of the work", () => {
  test("a failed refresh leaves the watermark where it was", async () => {
    // The window is retried rather than skipped. Doing a window twice costs
    // nothing; skipping one leaves a permanently wrong number.
    const { rollups, committed } = stub({ watermark: hoursAgo(2), failRefresh: true });
    await expect(rollupsRefresh(rollups)(job, context)).rejects.toThrow("statement timeout");
    expect(committed()).toBeNull();
  });

  test("a watermark at or ahead of now is a noop", async () => {
    // Clock skew between replicas, or a run that arrives before the clock has
    // moved. Advancing here would move the watermark backwards.
    const { rollups, calls } = stub({ watermark: now });
    const outcome = await rollupsRefresh(rollups)(job, context);
    expect(calls).toHaveLength(0);
    expect(outcome.kind).toBe("noop");
  });

  test("a watermark in the future is also a noop, not a negative window", async () => {
    const { rollups, calls } = stub({ watermark: Instant.plus(now, Duration.hours(1)) });
    expect((await rollupsRefresh(rollups)(job, context)).kind).toBe("noop");
    expect(calls).toHaveLength(0);
  });
});

describe("outcomes", () => {
  test("no dirty buckets is a noop, not a failure", async () => {
    // A job that ran and found nothing to do is not an error, and reading it
    // as one makes the logs useless.
    const { rollups } = stub({ watermark: hoursAgo(1), buckets: 0 });
    const outcome = await rollupsRefresh(rollups)(job, context);
    expect(outcome.kind).toBe("noop");
  });

  test("a noop still advances the watermark", async () => {
    // Otherwise a quiet period would make every subsequent run reprocess the
    // same widening window.
    const { rollups, committed } = stub({ watermark: hoursAgo(1), buckets: 0 });
    await rollupsRefresh(rollups)(job, context);
    expect(committed()).toBe(now);
  });

  test("work done is logged with the window it covered", async () => {
    logged.length = 0;
    const { rollups } = stub({ watermark: hoursAgo(1), buckets: 7 });
    await rollupsRefresh(rollups)(job, context);
    const line = logged.find((l) => l.event === "rollups.refreshed");
    expect(line?.fields).toMatchObject({ buckets: 7, caughtUp: true });
  });
});
