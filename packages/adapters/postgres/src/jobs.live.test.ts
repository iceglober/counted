/**
 * The job queue, against a real PostgreSQL.
 *
 * Everything here is a claim about SQL that an in-memory stub cannot make:
 * that two concurrent claims never take the same row, that a partial unique
 * index really does deduplicate an enqueue, and that a lease really does
 * return a job abandoned by a dead worker.
 *
 * These are the tests that decide whether the worker can run on more than one
 * replica, which is the whole of issue #52.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { Instant } from "@counted/domain";
import type { Job } from "@counted/ports";
import { createDatabase, type LiveDatabase } from "./testing/database";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import { CONTROL_PLANE_STATEMENTS } from "./sql/control-plane";
import { createJobQueue } from "./jobs";

const DB = "counted_v2_jobs";
const t0 = Instant.fromEpochMillis(Date.parse("2026-03-17T15:00:00.000Z"));
const later = (ms: number): Instant => Instant.fromEpochMillis(Instant.toEpochMillis(t0) + ms);

const LEASE = 60_000;

let pool: Pool | null = null;
let live: LiveDatabase | null = null;
let queue: ReturnType<typeof createJobQueue> | null = null;
let reachable = false;
let reason = "";

const dbTest = (name: string, fn: () => Promise<void>): void =>
  test(name, async () => {
    if (!reachable) {
      if (process.env["REQUIRE_DB"] === "1") throw new Error(`REQUIRE_DB=1 but no database: ${reason}`);
      return;
    }
    await fn();
  });

beforeAll(async () => {
  try {
    live = await createDatabase(DB);
    pool = live.pool;
    for (const s of SCHEMA_STATEMENTS) await pool.query(s);
    for (const s of CONTROL_PLANE_STATEMENTS) await pool.query(s);
    queue = createJobQueue(pool);
    reachable = true;
  } catch (e) {
    reachable = false;
    reason = (e as Error).message;
  }
});

afterAll(async () => {
  if (pool !== null) await pool.end();
  if (live !== null) await live.drop();
});

const clean = async () => {
  await pool!.query("TRUNCATE jobs");
};

const claim = (worker: string, limit = 10, at: Instant = t0) =>
  queue!.claim({ limit, worker, leaseMs: LEASE }, at);

describe("enqueuing the same job twice does nothing the second time", () => {
  dbTest("the unique index deduplicates", async () => {
    await clean();
    expect(await queue!.enqueue({ name: "outbox.dispatch", key: "bucket_1", runAfter: t0 }, t0)).toBe(true);
    // Every replica runs the scheduler; only one job comes out. No leader, no
    // lock, nothing to elect.
    expect(await queue!.enqueue({ name: "outbox.dispatch", key: "bucket_1", runAfter: t0 }, t0)).toBe(false);

    const { rows } = await pool!.query<{ n: string }>("SELECT count(*)::text AS n FROM jobs");
    expect(rows[0]!.n).toBe("1");
  });

  dbTest("racing enqueues produce one row, not an error", async () => {
    await clean();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => queue!.enqueue({ name: "outbox.dispatch", key: "race", runAfter: t0 }, t0)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  dbTest("a different key is a different job", async () => {
    await clean();
    await queue!.enqueue({ name: "outbox.dispatch", key: "a", runAfter: t0 }, t0);
    expect(await queue!.enqueue({ name: "outbox.dispatch", key: "b", runAfter: t0 }, t0)).toBe(true);
  });

  dbTest("a completed job still blocks its key — a bucket runs once, ever", async () => {
    // The bug this replaces: with a partial index excluding completed jobs, a
    // replica that enqueued, claimed, ran and completed within one tick left
    // nothing to conflict with, so the next replica enqueued the same job and
    // it ran a second time. Re-running is expressed with a different key.
    await clean();
    await queue!.enqueue({ name: "outbox.dispatch", key: "again", runAfter: t0 }, t0);
    const [job] = await claim("w1");
    await queue!.settle(job!, { kind: "done" }, t0, 0);
    expect(await queue!.enqueue({ name: "outbox.dispatch", key: "again", runAfter: t0 }, t0)).toBe(false);
  });
});

describe("two workers never take the same job", () => {
  dbTest("concurrent claims partition the queue", async () => {
    // `FOR UPDATE SKIP LOCKED`: the second claim skips what the first has
    // locked rather than blocking on it. This is the property the whole
    // multi-replica design rests on.
    await clean();
    for (let i = 0; i < 20; i++) {
      await queue!.enqueue({ name: "outbox.dispatch", key: `k${i}`, runAfter: t0 }, t0);
    }

    const [a, b, c] = await Promise.all([claim("w1", 20), claim("w2", 20), claim("w3", 20)]);
    const ids = [...a.map((j) => j.id), ...b.map((j) => j.id), ...c.map((j) => j.id)];

    expect(ids).toHaveLength(20);
    // No id appears twice: every job went to exactly one worker.
    expect(new Set(ids).size).toBe(20);
  });

  dbTest("a claimed job is not claimed again while its lease holds", async () => {
    await clean();
    await queue!.enqueue({ name: "outbox.dispatch", key: "held", runAfter: t0 }, t0);
    expect(await claim("w1")).toHaveLength(1);
    expect(await claim("w2", 10, later(LEASE - 1_000))).toHaveLength(0);
  });

  dbTest("the claimant is recorded, so a stuck job is traceable", async () => {
    const { rows } = await pool!.query<{ claimed_by: string }>(
      `SELECT claimed_by FROM jobs WHERE key = 'held'`,
    );
    expect(rows[0]!.claimed_by).toBe("w1");
  });
});

describe("a worker that dies does not strand its work", () => {
  dbTest("an expired lease lets another worker take the job", async () => {
    // A deploy, an OOM, a killed container. Without this, one bad deploy
    // strands work forever.
    await clean();
    await queue!.enqueue({ name: "outbox.dispatch", key: "abandoned", runAfter: t0 }, t0);
    const [taken] = await claim("dying-worker");
    expect(taken).toBeDefined();

    const afterLease = later(LEASE + 1_000);
    const [recovered] = await claim("healthy-worker", 10, afterLease);
    expect(recovered?.id).toBe(taken!.id);
  });

  dbTest("recovering counts as another attempt", async () => {
    // So a job that repeatedly kills its worker eventually stops rather than
    // cycling forever.
    const { rows } = await pool!.query<{ attempts: number }>(`SELECT attempts FROM jobs WHERE key = 'abandoned'`);
    expect(rows[0]!.attempts).toBe(2);
  });

  dbTest("stalled work is visible in the stats", async () => {
    const stats = await queue!.stats(later(LEASE + 120_000));
    expect(stats.pending).toBeGreaterThan(0);
    expect(stats.stalled).toBeGreaterThan(0);
  });
});

describe("a job runs when it is due, not before", () => {
  dbTest("a future job is not claimed", async () => {
    await clean();
    await queue!.enqueue({ name: "outbox.dispatch", key: "future", runAfter: later(60_000) }, t0);
    expect(await claim("w1")).toHaveLength(0);
    expect(await claim("w1", 10, later(61_000))).toHaveLength(1);
  });

  dbTest("a retry is not claimed until its backoff elapses", async () => {
    await clean();
    await queue!.enqueue({ name: "outbox.dispatch", key: "retry", runAfter: t0 }, t0);
    const [job] = await claim("w1");
    await queue!.settle(job!, { kind: "failed", error: "flaky", retryable: true }, t0, 30_000);

    expect(await claim("w1", 10, later(1_000))).toHaveLength(0);
    expect(await claim("w1", 10, later(31_000))).toHaveLength(1);
  });

  dbTest("due jobs come out oldest first", async () => {
    await clean();
    await queue!.enqueue({ name: "outbox.dispatch", key: "second", runAfter: later(-1_000) }, t0);
    await queue!.enqueue({ name: "outbox.dispatch", key: "first", runAfter: later(-5_000) }, t0);
    const claimed = await claim("w1");
    expect(claimed.map((j) => j.key)).toEqual(["first", "second"]);
  });
});

describe("attempts are bounded", () => {
  dbTest("a job stops retrying once its attempts are exhausted", async () => {
    await clean();
    const bounded = createJobQueue(pool!, { maxAttempts: 3 });
    await bounded.enqueue({ name: "outbox.dispatch", key: "doomed", runAfter: t0 }, t0);

    let last: Job | undefined;
    for (let i = 0; i < 4; i++) {
      const [job] = await bounded.claim({ limit: 1, worker: "w1", leaseMs: LEASE }, later(i * 120_000));
      if (job === undefined) break;
      last = job;
      await bounded.settle(job, { kind: "failed", error: "always", retryable: true }, later(i * 120_000), 0);
    }

    expect(last!.attempts).toBe(3);
    const { rows } = await pool!.query<{ outcome: string | null; completed_at: Date | null }>(
      `SELECT outcome, completed_at FROM jobs WHERE key = 'doomed'`,
    );
    // Completed-as-failed rather than left pending: it must stop consuming
    // claims and stop blocking the unique index.
    expect(rows[0]!.outcome).toBe("failed");
    expect(rows[0]!.completed_at).not.toBeNull();
  });

  dbTest("a non-retryable failure stops immediately", async () => {
    await clean();
    await queue!.enqueue({ name: "outbox.dispatch", key: "permanent", runAfter: t0 }, t0);
    const [job] = await claim("w1");
    await queue!.settle(job!, { kind: "failed", error: "no such workspace", retryable: false }, t0, 60_000);

    expect(await claim("w1", 10, later(600_000))).toHaveLength(0);
  });
});

describe("sharding divides the queue", () => {
  dbTest("two shards cover every job exactly once", async () => {
    // By a hash of the key rather than by row order, so adding a replica
    // redistributes evenly instead of moving a boundary.
    await clean();
    for (let i = 0; i < 40; i++) {
      await queue!.enqueue({ name: "outbox.dispatch", key: `shard_${i}`, runAfter: t0 }, t0);
    }

    const zero = await queue!.claim({ limit: 100, worker: "w0", leaseMs: LEASE, shard: { index: 0, total: 2 } }, t0);
    const one = await queue!.claim({ limit: 100, worker: "w1", leaseMs: LEASE, shard: { index: 1, total: 2 } }, t0);

    expect(zero.length + one.length).toBe(40);
    expect(new Set([...zero, ...one].map((j) => j.id)).size).toBe(40);
    // Both shards got work — a hash that sent everything to one shard would
    // pass the count check and be useless.
    expect(zero.length).toBeGreaterThan(0);
    expect(one.length).toBeGreaterThan(0);
  });

  dbTest("an unsharded claim takes everything", async () => {
    await clean();
    for (let i = 0; i < 10; i++) {
      await queue!.enqueue({ name: "outbox.dispatch", key: `all_${i}`, runAfter: t0 }, t0);
    }
    expect(await claim("w1", 100)).toHaveLength(10);
  });
});

describe("stats answer why nothing is running", () => {
  dbTest("pending, due and failed are counted", async () => {
    await clean();
    await queue!.enqueue({ name: "outbox.dispatch", key: "s1", runAfter: t0 }, t0);
    await queue!.enqueue({ name: "outbox.dispatch", key: "s2", runAfter: later(3_600_000) }, t0);

    const stats = await queue!.stats(t0);
    expect(stats.pending).toBe(2);
    // Only one is actually claimable now; a growing `due` means the workers
    // cannot keep up.
    expect(stats.due).toBe(1);
  });
});

describe("payloads survive the round trip", () => {
  dbTest("a job carries its payload back", async () => {
    await clean();
    await queue!.enqueue(
      { name: "retention.purge", key: "p1", payload: { workspace: "ws_1", months: 6 }, runAfter: t0 },
      t0,
    );
    const [job] = await claim("w1");
    expect(job!.payload).toEqual({ workspace: "ws_1", months: 6 });
  });

  dbTest("a job with no payload comes back as an empty object", async () => {
    await clean();
    await queue!.enqueue({ name: "outbox.dispatch", key: "empty", runAfter: t0 }, t0);
    const [job] = await claim("w1");
    expect(job!.payload).toEqual({});
  });

  dbTest("a row with an unrecognised name is skipped, not dispatched", async () => {
    // Better than handing a handler a name it does not know.
    await clean();
    await pool!.query(
      `INSERT INTO jobs (id, name, key, run_after) VALUES (gen_random_uuid(), 'jobs.fromTheFuture', 'x', $1)`,
      [Instant.toDate(t0)],
    );
    expect(await claim("w1")).toHaveLength(0);
  });
});
