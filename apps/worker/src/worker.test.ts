import { describe, expect, test } from "bun:test";

import type { Analysis } from "@counted/analytics-domain";
import { Threshold } from "@counted/dashboarding-domain";
import type { EventEnvelope } from "@counted/kernel";
import type { ProvisionWorkspaceDeps, WorkspaceRepository } from "@counted/tenancy-app";
import type { UnitOfWork } from "@counted/persistence-ports";

import { readConfig } from "./config";
import { recordingLogger } from "./logging";
import { workerJobs, createWorker, OUTBOX_DISPATCH, type WorkerDeps } from "./worker";
import { aMonitor, countingIds, FakeMonitors, FakeOutbox, anEnvelope, movableClock, T0 } from "./testing";

const config = (() => {
  const read = readConfig({ DATABASE_URL: "postgres://localhost/counted" });
  if (!read.ok) throw new Error("bad fixture");
  return read.value;
})();

const noWorkspaces: WorkspaceRepository = {
  find: async () => null,
  listForAccount: async () => [],
  save: async () => undefined,
};

const noTransaction: UnitOfWork<ProvisionWorkspaceDeps> = {
  transact: async () => {
    throw new Error("no transaction should be opened in this test");
  },
};

const depsWith = (
  overrides: Partial<WorkerDeps<Analysis>> = {},
): WorkerDeps<Analysis> & { logger: ReturnType<typeof recordingLogger> } => {
  const logger = recordingLogger();
  const monitors = new FakeMonitors([aMonitor({ threshold: Threshold.above(1_000_000) })]);
  return {
    config,
    clock: movableClock(),
    monitors: {
      monitors,
      clock: movableClock(),
      ids: countingIds(),
      isScalar: (a) => ({ ok: true, value: a }),
    },
    observe: async () => ({ kind: "observed", value: 1, computedAt: T0 }),
    notifier: { deliver: async () => undefined },
    outbox: new FakeOutbox([anEnvelope("a")]),
    dispatch: null,
    targets: { page: async () => ({ targets: [], examined: 0, cursor: null }) },
    retention: null,
    maintenance: null,
    compactor: null,
    organizations: null,
    workspaces: noWorkspaces,
    uow: noTransaction,
    recentProjects: { createdSince: async () => [] },
    credentials: null,
    memberships: null,
    projectDeps: null,
    ...overrides,
    logger,
  };
};

describe("assembling the schedule", () => {
  /**
   * With no sink, envelopes accumulate in a table somebody can look at. A
   * dispatcher that marked them delivered to nowhere would drop them silently
   * and permanently — the wrong direction to be wrong in.
   */
  test("the dispatch job is not registered when there is nowhere to dispatch to", () => {
    expect(workerJobs(depsWith()).map((job) => job.name)).not.toContain(OUTBOX_DISPATCH);
  });

  test("it is registered as soon as a dispatcher exists", async () => {
    const sent: EventEnvelope[] = [];
    const jobs = workerJobs(depsWith({ dispatch: async (e) => void sent.push(e) }));

    expect(jobs.map((job) => job.name)).toContain(OUTBOX_DISPATCH);
    const outbox = jobs.find((job) => job.name === OUTBOX_DISPATCH);
    await outbox?.run(T0);
    expect(sent.map((e) => e.id)).toEqual(["a"]);
  });

  test("a job with no implementation behind it reports unavailable and names what is missing", async () => {
    const deps = depsWith();
    const worker = createWorker(deps);

    const retention = await worker.runNow("retention", T0);
    const reconcile = await worker.runNow("reconcile", T0);

    expect(retention?.["available"]).toBe(false);
    expect(String(retention?.["missing"])).toContain("EventRetention");
    expect(reconcile?.["available"]).toBe(false);
    expect(String(reconcile?.["missing"])).toContain("OrganizationDirectory");

    // The same rule for the provisioning reconciler: without a credential
    // store it cannot tell a project with no key from one it simply cannot
    // see, and saying so is strictly better than reporting everything healthy.
    const provisioning = await worker.runNow("provisioning", T0);
    expect(provisioning?.["available"]).toBe(false);
    expect(String(provisioning?.["missing"])).toContain("CredentialStore");
  });

  test("one tick runs every job and logs a report for each", async () => {
    const deps = depsWith({ dispatch: async () => undefined });
    const worker = createWorker(deps);

    const outcome = await worker.tick(T0);

    expect([...outcome.started].sort()).toEqual([
      "maintenance",
      "monitors",
      "outbox",
      "provisioning",
      "reconcile",
      "retention",
    ]);
    expect(outcome.skipped).toEqual([]);
    expect(deps.logger.lines.filter((l) => l.event === "job.ran")).toHaveLength(6);
    expect(deps.logger.lines.some((l) => l.event === "job.failed")).toBe(false);
  });

  test("a maintenance finding is warned about rather than counted and forgotten", async () => {
    const deps = depsWith();
    const report = await createWorker(deps).runNow("maintenance", T0);

    expect(Number(report?.["findings"])).toBeGreaterThan(0);
    expect(deps.logger.lines.some((l) => l.event === "maintenance.finding")).toBe(true);
  });

  test("the monitor job's report reaches the log line, so a sweep of nothing is visible", async () => {
    const deps = depsWith();
    await createWorker(deps).runNow("monitors", T0);

    const ran = deps.logger.lines.find((l) => l.event === "job.ran" && l.fields["job"] === "monitors");
    expect(ran?.fields["considered"]).toBe(1);
    expect(ran?.fields["fired"]).toBe(0);
  });

  test("every job's interval comes from the config, not from a literal in the job", () => {
    const jobs = workerJobs(depsWith({ dispatch: async () => undefined }));
    const byName = new Map(jobs.map((job) => [job.name, job.every] as const));

    expect(byName.get("monitors")).toEqual(config.monitors.every);
    expect(byName.get("outbox")).toEqual(config.outbox.every);
    expect(byName.get("retention")).toEqual(config.retention.every);
    expect(byName.get("maintenance")).toEqual(config.maintenance.every);
    expect(byName.get("reconcile")).toEqual(config.reconcile.every);
  });
});
