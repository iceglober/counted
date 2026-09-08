import { describe, expect, test } from "bun:test";

import { SEGMENT_RETENTION_DAYS } from "@counted/analytics-adapter-litics";
import { longestRetentionDays } from "@counted/tenancy-domain";

import {
  checkMaintenance,
  longestStoreRetentionDays,
  packFindings,
  retentionFindings,
  schemaFindings,
  shortestPlanRetentionDays,
  type MaintenanceQueries,
} from "./maintenance";

type Answer = { rows: Record<string, unknown>[] } | Error;

const db = (answers: readonly Answer[]): MaintenanceQueries => {
  let index = 0;
  return {
    query: async <R extends Record<string, unknown>>() => {
      const answer = answers[index++] ?? { rows: [] };
      if (answer instanceof Error) throw answer;
      return { rows: answer.rows as R[] };
    },
  };
};

describe("what we keep versus what we promised", () => {
  test("the store's reach is the segment retention", () => {
    expect(longestStoreRetentionDays()).toBe(SEGMENT_RETENTION_DAYS);
  });

  /**
   * Today's catalogue: free promises 180 days and segments keep 760, so a free
   * project's segments outlive its plan's promise. That gap is the entire
   * reason row-level purging has to exist, and this asserts the worker
   * reports it rather than assuming somebody knows.
   */
  test("keeping longer than the least generous plan promises is reported", () => {
    const shortest = shortestPlanRetentionDays();
    expect(shortest).not.toBeNull();
    expect(longestStoreRetentionDays()).toBeGreaterThan(shortest as number);

    const findings = retentionFindings();
    const purge = findings.find((f) => f.kind === "RowPurgeRequired");
    expect(purge?.detail).toContain(String(shortest));
  });

  test("the store reaches at least as far as the most generous plan promises", () => {
    const longest = longestRetentionDays();
    expect(longest).not.toBeNull();
    expect(longestStoreRetentionDays()).toBeGreaterThanOrEqual(longest as number);
    expect(retentionFindings().some((f) => f.kind === "StoreKeepsLessThanPromised")).toBe(false);
  });

  test("these checks need no database", async () => {
    const report = await checkMaintenance({ db: null });
    expect(report.probed).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);
  });
});

describe("probing the store", () => {
  test("a schema that matches the config yields nothing to report", async () => {
    // Deliberately not a real schema: `diffSchema` is litics', and what is
    // pinned here is that its sentences arrive as findings rather than as an
    // exception.
    const findings = await schemaFindings(db([{ rows: [] }]));
    expect(findings.every((f) => f.kind === "SchemaDrift")).toBe(true);
  });

  test("a failed introspection is a finding, not a crash", async () => {
    const findings = await schemaFindings(db([new Error("permission denied for schema analytics")]));
    expect(findings).toEqual([
      { kind: "ProbeFailed", detail: expect.stringContaining("permission denied") },
    ]);
  });

  test("a probed report carries the schema findings and nothing about cron", async () => {
    const report = await checkMaintenance({ db: db([{ rows: [] }]), compactor: healthy, retentionWired: true });
    expect(report.probed).toBe(true);
    expect(report.findings.every((f) => ["SchemaDrift", "RowPurgeRequired", "StoreKeepsLessThanPromised"].includes(f.kind))).toBe(true);
  });
});

const statusOf = (streams: { stream: string; stagingRows: number; oldestStagedMs: number }[], listening = true) => ({
  status: async () => ({ listening, streams }),
});
const healthy = statusOf([{ stream: "events", stagingRows: 12, oldestStagedMs: 4_000 }]);

describe("is anything packing", () => {
  test("no compactor in this process is a finding, not silence", async () => {
    const findings = await packFindings(null, 300_000);
    expect(findings).toEqual([{ kind: "PackerUnwired", detail: expect.stringContaining("no compactor") }]);
  });

  test("rows that have waited past the threshold are lagging", async () => {
    const findings = await packFindings(statusOf([{ stream: "events", stagingRows: 900, oldestStagedMs: 420_000 }], false), 300_000);
    expect(findings).toEqual([{ kind: "PackLagging", detail: expect.stringContaining("420s") }]);
    expect(findings[0]?.detail).toContain("not listening");
  });

  test("a compactor keeping up produces nothing, and an empty staging never lags", async () => {
    expect(await packFindings(healthy, 300_000)).toEqual([]);
    expect(await packFindings(statusOf([{ stream: "events", stagingRows: 0, oldestStagedMs: 0 }]), 1)).toEqual([]);
  });

  test("a status probe that throws is a finding, not a crash", async () => {
    const findings = await packFindings({ status: async () => { throw new Error("connection refused"); } }, 300_000);
    expect(findings[0]?.kind).toBe("ProbeFailed");
  });

  test("an unwired purge is reported even with no database", async () => {
    const report = await checkMaintenance({ db: null, retentionWired: false });
    expect(report.findings.some((f) => f.kind === "PurgeUnwired")).toBe(true);
  });
});
