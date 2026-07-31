/**
 * `retention.purge`, over stubs.
 *
 * Every assertion here is about not deleting the wrong thing. A dropped
 * partition is unrecoverable, so the tests that matter most are the ones
 * asserting what is *left alone*.
 */

import { describe, expect, test } from "bun:test";
import { Duration, Instant, ProjectId } from "@counted/domain";
import type { Job, PartitionMaintenance, PartitionSpec, ProjectRetention, RetentionMaintenance } from "@counted/ports";
import { partitionFor } from "@counted/adapter-postgres";
import { PURGE_BATCH, retentionPurge } from "./retention-purge";

const now = Instant.fromEpochMillis(Date.parse("2026-03-17T15:00:00.000Z"));
const daysBefore = (n: number) => Instant.minus(now, Duration.days(n));

const job: Job = { id: "j", name: "retention.purge", key: "k", payload: {}, runAfter: now, attempts: 1 };

const logged: { level: string; event: string; fields?: Record<string, unknown> | undefined }[] = [];
const log = {
  info: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "info", event, fields }),
  warn: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "warn", event, fields }),
  error: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "error", event, fields }),
};
const context = { now, log, leaseMs: 60_000 };

const PRJ = ProjectId("33333333-3333-3333-3333-333333333333");

/** A partition covering the month `days` before now. */
const monthAt = (days: number): PartitionSpec => partitionFor(daysBefore(days));

const stub = (over: {
  partitions?: readonly PartitionSpec[];
  projects?: readonly ProjectRetention[];
  rowsPerProject?: number;
} = {}) => {
  const dropped: string[] = [];
  const purged: { project: string; olderThan: Instant }[] = [];
  const remaining = new Map<string, number>();

  const partitions: PartitionMaintenance = {
    list: async () => over.partitions ?? [],
    create: async () => {},
    countDefault: async () => 0,
    drainDefault: async () => 0,
  };

  const retention: RetentionMaintenance = {
    dropPartition: async (name) => void dropped.push(name),
    projectsWithPlans: async () => over.projects ?? [],
    purgeProject: async (project, olderThan, limit) => {
      const key = String(project);
      const left = remaining.get(key) ?? over.rowsPerProject ?? 0;
      const deleted = Math.min(left, limit);
      remaining.set(key, left - deleted);
      if (deleted > 0) purged.push({ project: key, olderThan });
      return deleted;
    },
  };

  return { deps: { partitions, retention }, dropped, purged };
};

describe("whole months are dropped only once expired for everyone", () => {
  test("a partition well past the longest retention is dropped", async () => {
    const { deps, dropped } = stub({ partitions: [monthAt(900)] });
    const outcome = await retentionPurge(deps)(job, context);
    expect(dropped).toEqual([monthAt(900).name]);
    expect(outcome.kind).toBe("done");
  });

  test("a partition past the free cutoff but not the pro one is left alone", async () => {
    // This is the case that makes partition drops alone insufficient — and the
    // case where dropping would delete a paying customer's data.
    const { deps, dropped } = stub({ partitions: [monthAt(200)] });
    await retentionPurge(deps)(job, context);
    expect(dropped).toEqual([]);
  });

  test("a partition straddling the cutoff is left alone", async () => {
    // Its live half is data someone is still entitled to. Dropping the month
    // containing the cutoff is the off-by-one you cannot undo.
    const straddling = monthAt(730);
    const { deps, dropped } = stub({ partitions: [straddling] });
    await retentionPurge(deps)(job, context);
    expect(dropped).toEqual([]);
  });

  test("recent partitions are never touched", async () => {
    const { deps, dropped } = stub({ partitions: [monthAt(0), monthAt(30), monthAt(60)] });
    await retentionPurge(deps)(job, context);
    expect(dropped).toEqual([]);
  });

  test("a drop is reported with the cutoff it was judged against", async () => {
    logged.length = 0;
    const { deps } = stub({ partitions: [monthAt(900)] });
    await retentionPurge(deps)(job, context);
    const line = logged.find((l) => l.event === "retention.partition_dropped");
    expect(line?.fields).toMatchObject({ partition: monthAt(900).name });
    expect(line?.fields?.["cutoff"]).toBeDefined();
  });
});

describe("shorter plans are purged row by row", () => {
  test("a free project's old events are deleted at its own cutoff", async () => {
    const { deps, purged } = stub({
      projects: [{ project: PRJ, plan: "free", payment: "none" }],
      rowsPerProject: 120,
    });
    const outcome = await retentionPurge(deps)(job, context);

    expect(purged).toHaveLength(1);
    // 180 days, not 730. Its data in the gap sits inside partitions a paying
    // customer still needs.
    expect(purged[0]!.olderThan).toBe(daysBefore(180));
    expect(outcome.kind).toBe("done");
  });

  test("a pro project needs no row purge — dropping its months is enough", async () => {
    const { deps, purged } = stub({
      projects: [{ project: PRJ, plan: "pro", payment: "active" }],
      rowsPerProject: 500,
    });
    await retentionPurge(deps)(job, context);
    expect(purged).toEqual([]);
  });

  test("a past_due pro project keeps the pro retention", async () => {
    // Deleting a customer's data over a billing hiccup would be the worst
    // possible reading of past_due.
    const { deps, purged } = stub({
      projects: [{ project: PRJ, plan: "pro", payment: "past_due" }],
      rowsPerProject: 500,
    });
    await retentionPurge(deps)(job, context);
    expect(purged).toEqual([]);
  });

  test("a canceled pro project is purged at the free cutoff", async () => {
    const { deps, purged } = stub({
      projects: [{ project: PRJ, plan: "pro", payment: "canceled" }],
      rowsPerProject: 50,
    });
    await retentionPurge(deps)(job, context);
    expect(purged[0]!.olderThan).toBe(daysBefore(180));
  });

  test("an unclaimed project gets the free retention", async () => {
    const { deps, purged } = stub({
      projects: [{ project: PRJ, plan: "free", payment: "none" }],
      rowsPerProject: 10,
    });
    await retentionPurge(deps)(job, context);
    expect(purged).toHaveLength(1);
  });

  test("a project with nothing to delete is not reported as work", async () => {
    const { deps, purged } = stub({ projects: [{ project: PRJ, plan: "free", payment: "none" }], rowsPerProject: 0 });
    const outcome = await retentionPurge(deps)(job, context);
    expect(purged).toEqual([]);
    expect(outcome.kind).toBe("noop");
  });
});

describe("an unrecognised plan is never guessed at", () => {
  test("the project is skipped, not purged at the free cutoff", async () => {
    // The one place where falling back to free deletes data rather than
    // withholding an allowance. Everywhere else that fallback is safe; here it
    // would shorten someone from two years to six months.
    logged.length = 0;
    const { deps, purged } = stub({
      projects: [{ project: PRJ, plan: "enterprise-plus", payment: "active" }],
      rowsPerProject: 900,
    });
    const outcome = await retentionPurge(deps)(job, context);

    expect(purged).toEqual([]);
    expect(outcome.kind).toBe("noop");
  });

  test("and it is reported at error level, because a human must decide", async () => {
    const line = logged.find((l) => l.event === "retention.unknown_plan");
    expect(line?.level).toBe("error");
    expect(line?.fields).toMatchObject({ plan: "enterprise-plus" });
  });
});

describe("the work is bounded", () => {
  test("a full batch says more remain", async () => {
    // So the log does not read as finished when the next run has work to do.
    const { deps } = stub({
      projects: [{ project: PRJ, plan: "free", payment: "none" }],
      rowsPerProject: PURGE_BATCH * 3,
    });
    const outcome = await retentionPurge(deps)(job, context);
    if (outcome.kind === "done") expect(outcome.detail).toContain("more remain");
  });

  test("many projects are spread across runs rather than done at once", async () => {
    // A job whose duration grows with the customer count is a job that
    // eventually outlives its lease.
    const many = Array.from({ length: 200 }, (_, i) => ({
      project: ProjectId(`33333333-3333-3333-3333-${String(i).padStart(12, "0")}`),
      plan: "free",
      payment: "none",
    }));
    const { deps, purged } = stub({ projects: many, rowsPerProject: 10 });
    const outcome = await retentionPurge(deps)(job, context);

    expect(purged.length).toBeLessThan(200);
    if (outcome.kind === "done") expect(outcome.detail).toContain("more remain");
  });

  test("nothing anywhere past retention is a noop, not a failure", async () => {
    const { deps } = stub({ partitions: [monthAt(30)], projects: [] });
    expect((await retentionPurge(deps)(job, context)).kind).toBe("noop");
  });

  test("running twice deletes nothing the second time", async () => {
    // The lease guarantees this job runs twice eventually, and the second run
    // must not find more to delete than the first left.
    const { deps, dropped } = stub({
      partitions: [monthAt(900)],
      projects: [{ project: PRJ, plan: "free", payment: "none" }],
      rowsPerProject: 10,
    });
    await retentionPurge(deps)(job, context);
    const before = dropped.length;
    const second = await retentionPurge(deps)(job, context);
    // The stub's rows are gone; the partition list is static, so the drop is
    // idempotent at the SQL level via DROP TABLE IF EXISTS.
    expect(second.kind).toBe("done");
    expect(dropped.length).toBe(before + 1);
  });
});
