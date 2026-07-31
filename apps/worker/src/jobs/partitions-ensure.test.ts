/**
 * `partitions.ensure`, over a stub.
 *
 * The behaviour under test is the decision: which months are required, what
 * happens when they already exist, and what happens when rows have landed in
 * the default partition. Whether the SQL works is proven against a real
 * database in the adapter's live tests.
 */

import { describe, expect, test } from "bun:test";
import { Instant } from "@counted/domain";
import type { Job, PartitionMaintenance, PartitionSpec } from "@counted/ports";
import { DefaultPartitionTooLarge, requiredPartitions } from "@counted/adapter-postgres";
import { MONTHS_AHEAD, partitionsEnsure } from "./partitions-ensure";

const march = Instant.fromEpochMillis(Date.parse("2026-03-17T15:00:00.000Z"));

const job: Job = {
  id: "job_1",
  name: "partitions.ensure",
  key: "k",
  payload: {},
  runAfter: march,
  attempts: 1,
};

const logged: { level: string; event: string; fields?: Record<string, unknown> | undefined }[] = [];
const log = {
  info: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "info", event, fields }),
  warn: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "warn", event, fields }),
  error: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "error", event, fields }),
};

const context = { now: march, log, leaseMs: 60_000 };

/**
 * `strandedMonths` models the real contract: one call drains one month whole,
 * because a partition cannot be created while any of its rows sit in the
 * default. A stub that moved an arbitrary row count would let the handler pass
 * a test the adapter could never satisfy.
 */
const stub = (over: Partial<{ existing: readonly PartitionSpec[]; strandedMonths: readonly number[] }> = {}) => {
  const created: string[] = [];
  const months = [...(over.strandedMonths ?? [])];
  const maintenance: PartitionMaintenance = {
    list: async () => over.existing ?? [],
    create: async (spec) => void created.push(spec.name),
    countDefault: async () => months.reduce((a, b) => a + b, 0),
    drainDefault: async () => months.shift() ?? 0,
  };
  return { maintenance, created };
};

describe("the months that must exist", () => {
  test("this month and three more", () => {
    // Three, not one: the job runs hourly, so one would do if nothing ever
    // went wrong, but a worker down for a week must not come back to find
    // ingestion already broken.
    const required = requiredPartitions(march, MONTHS_AHEAD);
    expect(required.map((p) => p.name)).toEqual([
      "events_2026_03",
      "events_2026_04",
      "events_2026_05",
      "events_2026_06",
    ]);
  });

  test("the months step by the calendar, not by thirty days", () => {
    // January to February is 31 days and February to March is 28. Adding
    // thirty days lands mid-month and creates overlapping bounds.
    const january = Instant.fromEpochMillis(Date.parse("2026-01-31T23:59:59.000Z"));
    expect(requiredPartitions(january, 2).map((p) => p.name)).toEqual([
      "events_2026_01",
      "events_2026_02",
      "events_2026_03",
    ]);
  });

  test("crossing a year boundary works", () => {
    const november = Instant.fromEpochMillis(Date.parse("2026-11-05T00:00:00.000Z"));
    expect(requiredPartitions(november, 3).map((p) => p.name)).toEqual([
      "events_2026_11",
      "events_2026_12",
      "events_2027_01",
      "events_2027_02",
    ]);
  });

  test("each partition's bounds are contiguous and half-open", () => {
    // No gap and no overlap, or an event on a boundary belongs to two
    // partitions or to none.
    const required = requiredPartitions(march, 4);
    for (let i = 1; i < required.length; i++) {
      expect(required[i]!.from).toBe(required[i - 1]!.to);
    }
  });
});

describe("creating what is missing", () => {
  test("a fresh database gets every required month", async () => {
    const { maintenance, created } = stub();
    const outcome = await partitionsEnsure(maintenance)(job, context);
    expect(created).toHaveLength(MONTHS_AHEAD + 1);
    expect(outcome.kind).toBe("done");
  });

  test("nothing is created when everything exists", async () => {
    const { maintenance, created } = stub({ existing: requiredPartitions(march, MONTHS_AHEAD) });
    const outcome = await partitionsEnsure(maintenance)(job, context);
    expect(created).toHaveLength(0);
    // A noop, not a failure. A job that ran and found nothing to do is not an
    // error, and reading it as one makes the logs useless.
    expect(outcome.kind).toBe("noop");
  });

  test("only the gap is filled", async () => {
    const all = requiredPartitions(march, MONTHS_AHEAD);
    const { maintenance, created } = stub({ existing: [all[0]!, all[2]!] });
    await partitionsEnsure(maintenance)(job, context);
    expect(created).toEqual([all[1]!.name, all[3]!.name]);
  });

  test("running twice creates nothing the second time", async () => {
    // The lease guarantees a job will eventually run twice, so this is the
    // property that matters most.
    const state = requiredPartitions(march, MONTHS_AHEAD);
    const { maintenance } = stub({ existing: state });
    const first = await partitionsEnsure(maintenance)(job, context);
    const second = await partitionsEnsure(maintenance)(job, context);
    expect(first).toEqual(second);
  });
});

describe("rows stranded in the default partition", () => {
  test("they are reported loudly", async () => {
    // A row there is not lost, but it is invisible to retention and it
    // defeats pruning. Worth knowing even after it has been fixed.
    logged.length = 0;
    const { maintenance } = stub({ existing: requiredPartitions(march, MONTHS_AHEAD), strandedMonths: [1_200] });
    await partitionsEnsure(maintenance)(job, context);
    const warning = logged.find((l) => l.event === "partitions.default_occupied");
    expect(warning?.level).toBe("warn");
    expect(warning?.fields).toMatchObject({ rows: 1_200 });
  });

  test("they are moved, not merely counted", async () => {
    const { maintenance } = stub({ existing: requiredPartitions(march, MONTHS_AHEAD), strandedMonths: [100] });
    const outcome = await partitionsEnsure(maintenance)(job, context);
    expect(outcome.kind).toBe("done");
    if (outcome.kind === "done") expect(outcome.detail).toContain("drained 100");
  });

  test("several stranded months say more remain, so the log does not read as fixed", async () => {
    // One month per run. A long outage takes a few hours of ticks to unwind,
    // and the log should say so rather than implying it is done.
    const { maintenance } = stub({
      existing: requiredPartitions(march, MONTHS_AHEAD),
      strandedMonths: [500, 700, 900],
    });
    const outcome = await partitionsEnsure(maintenance)(job, context);
    if (outcome.kind === "done") expect(outcome.detail).toContain("more remain");
  });

  test("the last stranded month does not say more remain", async () => {
    const { maintenance } = stub({ existing: requiredPartitions(march, MONTHS_AHEAD), strandedMonths: [500] });
    const outcome = await partitionsEnsure(maintenance)(job, context);
    if (outcome.kind === "done") expect(outcome.detail).not.toContain("more remain");
  });

  test("an empty default partition produces no warning", async () => {
    logged.length = 0;
    const { maintenance } = stub({ existing: requiredPartitions(march, MONTHS_AHEAD) });
    await partitionsEnsure(maintenance)(job, context);
    expect(logged.find((l) => l.event === "partitions.default_occupied")).toBeUndefined();
  });

  test("a month too large to move is a permanent failure, not an endless retry", async () => {
    // The threshold is a constant and the month will not shrink, so retrying
    // burns attempts for nothing. It fails permanently and shows up in the
    // failed count where an operator will see it.
    logged.length = 0;
    const oversized: PartitionMaintenance = {
      list: async () => requiredPartitions(march, MONTHS_AHEAD),
      create: async () => {},
      countDefault: async () => 9_000_000,
      drainDefault: async (limit) => {
        throw new DefaultPartitionTooLarge(new Date("2026-01-01T00:00:00Z"), 9_000_000, limit);
      },
    };

    const outcome = await partitionsEnsure(oversized)(job, context);
    expect(outcome).toMatchObject({ kind: "failed", retryable: false });
    const reported = logged.find((l) => l.event === "partitions.default_too_large");
    expect(reported?.level).toBe("error");
    expect(reported?.fields).toMatchObject({ month: "2026-01", rows: 9_000_000 });
  });

  test("an unexpected error is not swallowed as a permanent failure", async () => {
    // Only the too-large case is permanent. A connection reset must stay
    // retryable, and the runtime turns a throw into exactly that.
    const flaky: PartitionMaintenance = {
      list: async () => [],
      create: async () => {},
      countDefault: async () => 10,
      drainDefault: async () => {
        throw new Error("connection reset");
      },
    };
    await expect(partitionsEnsure(flaky)(job, context)).rejects.toThrow("connection reset");
  });

  test("draining alone is enough to count as work done", async () => {
    // Everything existed, but rows were rescued. Reporting that as a noop
    // would hide the only interesting thing that happened.
    const { maintenance } = stub({ existing: requiredPartitions(march, MONTHS_AHEAD), strandedMonths: [5] });
    expect((await partitionsEnsure(maintenance)(job, context)).kind).toBe("done");
  });
});
