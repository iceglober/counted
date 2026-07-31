/**
 * The run loop, over an in-memory queue.
 *
 * The concurrency guarantees belong to SQL and are tested against a real
 * database in the adapter. What is tested here is everything above that: that
 * the scheduler is idempotent, that a throw becomes a retry rather than a lost
 * job, that a permanent failure stops burning attempts, and that stopping
 * settles the work in flight.
 */

import { describe, expect, test } from "bun:test";
import { Instant } from "@counted/domain";
import type { ClaimOptions, EnqueueRequest, Job, JobOutcome, JobQueue, JobStats } from "@counted/ports";
import { WorkerRuntime, backoffMs, type Handler, type RuntimeOptions } from "./runtime";
import { SCHEDULES, bucketKey, bucketStart } from "./schedule";

const t0 = Instant.fromEpochMillis(Date.parse("2026-03-17T15:00:00.000Z"));

const silent = { info: () => {}, warn: () => {}, error: () => {} };

/** An in-memory queue with the same contract as the SQL one. */
const memoryQueue = () => {
  const rows: {
    job: Job;
    completed: boolean;
    outcome: string | null;
    claimedAt: number | null;
    error: string | null;
  }[] = [];
  let n = 0;

  const queue: JobQueue = {
    async enqueue(request: EnqueueRequest): Promise<boolean> {
      // The unique index, in memory: one job per (name, key), completed or
      // not. Excluding completed ones is the bug the SQL version had — a
      // replica that ran a job within one tick left nothing to conflict with.
      const existing = rows.find((r) => r.job.name === request.name && r.job.key === request.key);
      if (existing !== undefined) return false;
      rows.push({
        job: {
          id: `job_${n++}`,
          name: request.name,
          key: request.key,
          payload: request.payload ?? {},
          runAfter: request.runAfter,
          attempts: 0,
        },
        completed: false,
        outcome: null,
        claimedAt: null,
        error: null,
      });
      return true;
    },

    async claim(options: ClaimOptions, at: Instant): Promise<readonly Job[]> {
      const now = Instant.toEpochMillis(at);
      const taken: Job[] = [];
      for (const row of rows) {
        if (taken.length >= options.limit) break;
        if (row.completed) continue;
        if (Instant.toEpochMillis(row.job.runAfter) > now) continue;
        if (row.claimedAt !== null && row.claimedAt >= now - options.leaseMs) continue;
        row.claimedAt = now;
        row.job = { ...row.job, attempts: row.job.attempts + 1 };
        taken.push(row.job);
      }
      return taken;
    },

    async settle(job: Job, outcome: JobOutcome, at: Instant, retryAfterMs: number): Promise<void> {
      const row = rows.find((r) => r.job.id === job.id);
      if (row === undefined) return;
      if (outcome.kind !== "failed") {
        row.completed = true;
        row.outcome = outcome.kind;
        return;
      }
      row.error = outcome.error;
      if (!outcome.retryable || job.attempts >= 8) {
        row.completed = true;
        row.outcome = "failed";
        return;
      }
      row.claimedAt = null;
      row.job = { ...row.job, runAfter: Instant.fromEpochMillis(Instant.toEpochMillis(at) + retryAfterMs) };
    },

    async stats(): Promise<JobStats> {
      return {
        pending: rows.filter((r) => !r.completed).length,
        due: rows.filter((r) => !r.completed && r.claimedAt === null).length,
        stalled: 0,
        failed: rows.filter((r) => r.outcome === "failed").length,
      };
    },
  };

  return { queue, rows };
};

const runtime = (handlers: RuntimeOptions["handlers"], over: Partial<{ queue: JobQueue }> = {}) => {
  const memory = memoryQueue();
  const queue = over.queue ?? memory.queue;
  return {
    memory,
    runtime: new WorkerRuntime({
      queue,
      clock: { now: () => t0 },
      log: silent,
      handlers,
      worker: "worker-1",
      schedules: [{ name: "outbox.dispatch", everyMs: 10_000, leaseMs: 60_000, why: "test" }],
    }),
  };
};

const ok: Handler = async () => ({ kind: "done" });

describe("scheduling is idempotent without a leader", () => {
  test("a second tick in the same bucket enqueues nothing new", async () => {
    // Every replica computes the same bucket key, so all but one enqueue is a
    // no-op. No election, no lock, nothing to go wrong.
    const { runtime: r, memory } = runtime({ "outbox.dispatch": ok });
    expect(await r.schedule(t0)).toBe(1);
    expect(await r.schedule(t0)).toBe(0);
    expect(memory.rows).toHaveLength(1);
  });

  test("two workers sharing a queue produce one job", async () => {
    const memory = memoryQueue();
    const a = runtime({ "outbox.dispatch": ok }, { queue: memory.queue }).runtime;
    const b = runtime({ "outbox.dispatch": ok }, { queue: memory.queue }).runtime;
    await Promise.all([a.schedule(t0), b.schedule(t0)]);
    expect(memory.rows).toHaveLength(1);
  });

  test("the next bucket does enqueue again", async () => {
    const { runtime: r, memory } = runtime({ "outbox.dispatch": ok });
    await r.schedule(t0);
    await r.schedule(Instant.fromEpochMillis(Instant.toEpochMillis(t0) + 10_000));
    expect(memory.rows).toHaveLength(2);
  });

  test("a job with no handler on this replica is not enqueued by it", async () => {
    // Otherwise a worker fills the queue with work nothing it runs will claim.
    const { runtime: r, memory } = runtime({});
    expect(await r.schedule(t0)).toBe(0);
    expect(memory.rows).toHaveLength(0);
  });
});

describe("bucket keys", () => {
  test("every instant inside a bucket gives the same key", () => {
    const schedule = SCHEDULES[0]!;
    const start = bucketStart(schedule, t0);
    const middle = Instant.fromEpochMillis(Instant.toEpochMillis(start) + schedule.everyMs - 1);
    expect(bucketKey(schedule, start)).toBe(bucketKey(schedule, middle));
  });

  test("the next bucket gives a different key", () => {
    const schedule = SCHEDULES[0]!;
    const next = Instant.fromEpochMillis(Instant.toEpochMillis(t0) + schedule.everyMs);
    expect(bucketKey(schedule, t0)).not.toBe(bucketKey(schedule, next));
  });

  test("the key includes the interval, so changing a cadence does not collide", () => {
    // Two schedules whose buckets happen to align must not share a key.
    const hourly = { name: "rollups.refresh" as const, everyMs: 3_600_000, leaseMs: 1, why: "" };
    const daily = { name: "rollups.refresh" as const, everyMs: 86_400_000, leaseMs: 1, why: "" };
    const midnight = Instant.fromEpochMillis(Date.parse("2026-03-17T00:00:00.000Z"));
    expect(bucketKey(hourly, midnight)).not.toBe(bucketKey(daily, midnight));
  });

  test("a job is due from the start of its bucket, not from now", () => {
    // So a worker starting mid-bucket picks up that bucket's job immediately
    // rather than waiting for the next one.
    const schedule = SCHEDULES[0]!;
    expect(Instant.toEpochMillis(bucketStart(schedule, t0))).toBeLessThanOrEqual(Instant.toEpochMillis(t0));
  });
});

describe("a failing job is retried, not lost", () => {
  test("a handler that throws becomes a retryable failure", async () => {
    // A job that dies on an unexpected error should be retried. v1's buffer
    // dropped a failed batch and told nobody.
    const { runtime: r, memory } = runtime({
      "outbox.dispatch": async () => {
        throw new Error("connection reset");
      },
    });
    const report = await r.runOnce(t0);
    expect(report.failed).toBe(1);
    expect(memory.rows[0]!.completed).toBe(false);
    expect(memory.rows[0]!.error).toBe("connection reset");
  });

  test("a handler that knows it cannot succeed stops burning attempts", async () => {
    const { runtime: r, memory } = runtime({
      "outbox.dispatch": async () => ({ kind: "failed", error: "no such workspace", retryable: false }),
    });
    await r.runOnce(t0);
    expect(memory.rows[0]!.completed).toBe(true);
    expect(memory.rows[0]!.outcome).toBe("failed");
  });

  test("a failed job is not re-enqueued in the same bucket", async () => {
    // It failed permanently; retrying it under the same key would be an
    // infinite loop with extra steps. The next bucket has a different key.
    const { runtime: r, memory } = runtime({
      "outbox.dispatch": async () => ({ kind: "failed", error: "permanent", retryable: false }),
    });
    await r.runOnce(t0);
    await r.schedule(t0);
    expect(memory.rows).toHaveLength(1);

    const nextBucket = Instant.fromEpochMillis(Instant.toEpochMillis(t0) + 10_000);
    await r.schedule(nextBucket);
    expect(memory.rows).toHaveLength(2);
  });

  test("a retry is scheduled into the future, not immediately", async () => {
    const { runtime: r, memory } = runtime({
      "outbox.dispatch": async () => ({ kind: "failed", error: "flaky", retryable: true }),
    });
    await r.runOnce(t0);
    expect(Instant.toEpochMillis(memory.rows[0]!.job.runAfter)).toBeGreaterThan(Instant.toEpochMillis(t0));
  });

  test("an unhandled job name is retried rather than failed", async () => {
    // Enqueued by a replica that has the handler, claimed by one that does
    // not. Another worker will get it; burning attempts here would exhaust it.
    const memory = memoryQueue();
    await memory.queue.enqueue({ name: "rollups.refresh", key: "k", runAfter: t0 }, t0);
    const r = new WorkerRuntime({
      queue: memory.queue,
      clock: { now: () => t0 },
      log: silent,
      handlers: {},
      worker: "w",
      schedules: [],
    });
    await r.runOnce(t0);
    expect(memory.rows[0]!.completed).toBe(false);
  });
});

describe("backoff", () => {
  test("it grows with attempts", () => {
    const fixed = () => 1;
    expect(backoffMs(1, fixed)).toBeLessThan(backoffMs(5, fixed));
  });

  test("it is capped, so a stuck job still retries eventually", () => {
    expect(backoffMs(100, () => 1)).toBeLessThanOrEqual(30 * 60_000);
  });

  test("it is jittered", () => {
    // Without jitter every job that failed in the same outage retries in the
    // same millisecond, which knocks a recovering database over again.
    expect(backoffMs(5, () => 0)).not.toBe(backoffMs(5, () => 1));
  });

  test("it is never zero or negative", () => {
    for (let attempts = 0; attempts < 20; attempts++) {
      expect(backoffMs(attempts, () => 0)).toBeGreaterThan(0);
    }
  });
});

describe("outcomes are distinguished", () => {
  test("done and noop both complete, and are told apart", async () => {
    // A job that ran and found nothing to do is not a failure, and reading it
    // as one makes the logs useless.
    const { runtime: r, memory } = runtime({ "outbox.dispatch": async () => ({ kind: "noop" }) });
    const report = await r.runOnce(t0);
    expect(report.noop).toBe(1);
    expect(report.done).toBe(0);
    expect(memory.rows[0]!.outcome).toBe("noop");
  });

  test("a tick reports what it did", async () => {
    const { runtime: r } = runtime({ "outbox.dispatch": ok });
    expect(await r.runOnce(t0)).toEqual({ enqueued: 1, claimed: 1, done: 1, failed: 0, noop: 0 });
  });
});

describe("the loop survives and stops cleanly", () => {
  test("a tick that throws does not take the loop down", async () => {
    // A database blip must not leave the queue unattended.
    let ticks = 0;
    const exploding: JobQueue = {
      enqueue: async () => {
        ticks += 1;
        if (ticks < 3) throw new Error("database is down");
        return false;
      },
      claim: async () => [],
      settle: async () => {},
      stats: async () => ({ pending: 0, due: 0, stalled: 0, failed: 0 }),
    };

    const r = new WorkerRuntime({
      queue: exploding,
      clock: { now: () => t0 },
      log: silent,
      handlers: { "outbox.dispatch": ok },
      worker: "w",
      schedules: [{ name: "outbox.dispatch", everyMs: 1_000, leaseMs: 1_000, why: "test" }],
    });

    const started = r.start(0, async () => {
      if (ticks >= 4) r.stop();
    });
    await started;
    expect(ticks).toBeGreaterThanOrEqual(4);
  });

  test("stop ends the loop and reports it is no longer running", async () => {
    const { runtime: r } = runtime({ "outbox.dispatch": ok });
    let slept = 0;
    const started = r.start(0, async () => {
      slept += 1;
      if (slept >= 2) r.stop();
    });
    await started;
    expect(r.isRunning()).toBe(false);
  });

  test("the current tick finishes before stopping", async () => {
    // A job interrupted halfway is what the lease exists to recover, and a
    // deploy should not need that recovery for work that was nearly done.
    const { runtime: r, memory } = runtime({ "outbox.dispatch": ok });
    let slept = 0;
    await r.start(0, async () => {
      slept += 1;
      if (slept >= 1) r.stop();
    });
    expect(memory.rows[0]!.completed).toBe(true);
  });
});

describe("every schedule is coherent", () => {
  test("a lease is longer than nothing and the cadence is positive", () => {
    for (const schedule of SCHEDULES) {
      expect(schedule.everyMs).toBeGreaterThan(0);
      expect(schedule.leaseMs).toBeGreaterThan(0);
    }
  });

  test("every schedule explains its cadence", () => {
    // The next person should not have to guess why a number was chosen.
    for (const schedule of SCHEDULES) expect(schedule.why.length).toBeGreaterThan(30);
  });

  test("no two schedules share a name", () => {
    expect(new Set(SCHEDULES.map((s) => s.name)).size).toBe(SCHEDULES.length);
  });
});
