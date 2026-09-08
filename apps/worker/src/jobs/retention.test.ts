import { describe, expect, test } from "bun:test";

import { Duration, Instant, ProjectId, WorkspaceId, ok } from "@counted/kernel";
import { PLAN_IDS, PlanCatalog, retentionCutoff as planCutoff } from "@counted/tenancy-domain";
import {
  RETENTION_INHERIT,
  retentionCutoff as projectCutoff,
  retentionPolicy,
} from "@counted/projects-domain";

import { enforceRetention, purgeFor } from "./retention";
import { recordingLogger } from "../logging";
import type { EventRetention, RetentionPage, RetentionTarget, RetentionTargets } from "../ports";
import { T0 } from "../testing";

const target = (overrides: Partial<RetentionTarget> = {}): RetentionTarget => ({
  project: ProjectId("pr_1"),
  workspace: WorkspaceId("ws_1"),
  plan: "free",
  payment: "none",
  policy: RETENTION_INHERIT,
  ...overrides,
});

const policyOf = (n: number) => {
  const built = retentionPolicy(n);
  if (!built.ok) throw new Error("bad fixture");
  return built.value;
};

const daysBefore = (n: number): Instant => Instant.minus(T0, Duration.days(n));

describe("what may be deleted", () => {
  test("a project inherits its plan's retention", () => {
    const free = PlanCatalog.limitsFor("free").retentionDays;
    expect(free).not.toBeNull();
    expect(purgeFor(target(), T0)?.before).toEqual(daysBefore(free as number));
  });

  test("a project may keep less than its plan allows", () => {
    expect(purgeFor(target({ policy: policyOf(30) }), T0)?.before).toEqual(daysBefore(30));
  });

  /**
   * The clamp is applied here rather than at write time, so a downgrade
   * shortens retention immediately instead of the next time somebody edits the
   * field.
   */
  test("a project may not keep more than its plan allows", () => {
    const free = PlanCatalog.limitsFor("free").retentionDays as number;
    expect(purgeFor(target({ policy: policyOf(free + 500) }), T0)?.before).toEqual(daysBefore(free));
  });

  /**
   * A past-due customer keeps the plan they bought while the card is chased.
   * Reading the plan column alone and ignoring payment state is v1's bug in the
   * other direction — here it would delete a paying customer's data the day
   * their card expired.
   */
  test("a past-due workspace keeps its paid retention", () => {
    const pro = PlanCatalog.limitsFor("pro").retentionDays as number;
    const request = purgeFor(target({ plan: "pro", payment: "past_due" }), T0);
    expect(request?.before).toEqual(daysBefore(pro));
  });

  test("a canceled workspace falls back to the free retention", () => {
    const free = PlanCatalog.limitsFor("free").retentionDays as number;
    expect(purgeFor(target({ plan: "pro", payment: "canceled" }), T0)?.before).toEqual(
      daysBefore(free),
    );
  });

  /**
   * No plan keeps events indefinitely today, so `purgeFor`'s null branch cannot
   * be reached through the catalogue — which is exactly why it is pinned here
   * against the two functions it composes. The day an unlimited plan is added,
   * "keep forever" must produce no purge request, not a cutoff of now.
   */
  test("`keep indefinitely` produces no purge at all, never `delete now`", () => {
    expect(PLAN_IDS.every((id) => PlanCatalog.limitsFor(id).retentionDays !== null)).toBe(true);

    expect(planCutoff({ plan: "pro", inGrace: false, limits: { ...PlanCatalog.limitsFor("pro"), retentionDays: null } }, T0)).toBeNull();
    expect(projectCutoff(RETENTION_INHERIT, null, T0)).toBeNull();
    // A project may still pin a shorter window under an unlimited plan: that is
    // the one case where its own number wins outright rather than by being
    // smaller.
    expect(projectCutoff(policyOf(30), null, T0)).toEqual(daysBefore(30));
  });
});

const pages = (chunks: readonly RetentionPage[]): RetentionTargets => {
  let index = 0;
  return {
    page: async () => chunks[index++] ?? { targets: [], examined: 0, cursor: null },
  };
};

describe("the retention sweep", () => {
  test("with no store to delete from, it says so rather than reporting success", async () => {
    const report = await enforceRetention(
      {
        targets: pages([]),
        retention: null,
        logger: recordingLogger(),
        pageSize: 10,
        maxProjects: 100,
      },
      T0,
    );

    expect(report.kind).toBe("unavailable");
    if (report.kind !== "unavailable") throw new Error("unreachable");
    expect(report.missing).toContain("EventRetention");
  });

  test("it walks by cursor, so a row it cannot read does not stall the walk", async () => {
    const purged: string[] = [];
    const retention: EventRetention = {
      purge: async (request) => {
        purged.push(String(request.project));
        return ok(7);
      },
    };

    const report = await enforceRetention(
      {
        targets: pages([
          // Two rows returned, one unreadable, and the cursor is the raw last
          // row — not the last readable one.
          {
            targets: [target({ project: ProjectId("pr_1") })],
            examined: 2,
            cursor: ProjectId("pr_2"),
          },
          { targets: [target({ project: ProjectId("pr_3") })], examined: 1, cursor: null },
        ]),
        retention,
        logger: recordingLogger(),
        pageSize: 2,
        maxProjects: 100,
      },
      T0,
    );

    expect(report).toMatchObject({ kind: "swept", scanned: 2, unreadable: 1, purged: 2, rowsDeleted: 14 });
    expect(purged).toEqual(["pr_1", "pr_3"]);
  });

  test("a refused purge is counted and the sweep continues", async () => {
    const retention: EventRetention = {
      purge: async (request) =>
        String(request.project) === "pr_1"
          ? { ok: false, error: { kind: "Timeout" } }
          : ok(3),
    };
    const logger = recordingLogger();

    const report = await enforceRetention(
      {
        targets: pages([
          {
            targets: [target({ project: ProjectId("pr_1") }), target({ project: ProjectId("pr_2") })],
            examined: 2,
            cursor: null,
          },
        ]),
        retention,
        logger,
        pageSize: 2,
        maxProjects: 100,
      },
      T0,
    );

    expect(report).toMatchObject({ due: 2, purged: 1, failures: 1, rowsDeleted: 3 });
    expect(logger.lines.some((l) => l.event === "retention.purge-refused")).toBe(true);
  });

  test("a thrown purge is caught, so one project cannot end the sweep", async () => {
    const retention: EventRetention = {
      purge: async (request) => {
        if (String(request.project) === "pr_1") throw new Error("connection reset");
        return ok(1);
      },
    };

    const report = await enforceRetention(
      {
        targets: pages([
          {
            targets: [target({ project: ProjectId("pr_1") }), target({ project: ProjectId("pr_2") })],
            examined: 2,
            cursor: null,
          },
        ]),
        retention,
        logger: recordingLogger(),
        pageSize: 2,
        maxProjects: 100,
      },
      T0,
    );

    expect(report).toMatchObject({ scanned: 2, purged: 1, failures: 1 });
  });

  test("the per-tick ceiling stops the walk even when there is more to do", async () => {
    let asked = 0;
    const targets: RetentionTargets = {
      page: async (_after, limit) => {
        asked += 1;
        return {
          targets: Array.from({ length: limit }, (_, i) =>
            target({ project: ProjectId(`pr_${asked}_${i}`) }),
          ),
          examined: limit,
          cursor: ProjectId(`pr_${asked}_last`),
        };
      },
    };

    const report = await enforceRetention(
      {
        targets,
        retention: { purge: async () => ok(0) },
        logger: recordingLogger(),
        pageSize: 3,
        maxProjects: 7,
      },
      T0,
    );

    expect(report).toMatchObject({ kind: "swept", scanned: 7 });
  });
});
