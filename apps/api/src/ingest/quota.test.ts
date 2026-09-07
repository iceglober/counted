/**
 * The derived quota.
 *
 * The interesting invariant is the one the cache creates. Reading the period's
 * count per request would be an analytics query on the hot path, so the reading is
 * cached — and a cache alone would let a customer at 99% send a million events
 * inside one refresh window with every one admitted. `record` advancing the
 * cached count locally is what closes that, and it is what these tests pin.
 */

import { describe, expect, test } from "bun:test";
import { Duration, Instant, type ProjectId, type WorkspaceId } from "@counted/kernel";
import { Entitlement } from "@counted/tenancy-domain";
import type { AnalyticsEngine, Bucket } from "@counted/analytics-ports";
import { derivedIngestQuota, type QuotaDeps } from "./quota";
import { silentLogger } from "../logging";
import { unavailableEngine } from "../testing";

const AT = Instant.fromEpochMillis(Date.UTC(2026, 2, 15, 12, 0, 0));
const PROJECT = "pr_1" as ProjectId;
const WORKSPACE = "ws_1" as WorkspaceId;

const counting = (used: number, calls: { n: number }): AnalyticsEngine =>
  unavailableEngine({
    counts: async () => {
      calls.n += 1;
      const buckets: Bucket[] = [{ start: AT, value: used }];
      return { ok: true, value: { buckets }, computedAt: AT };
    },
  });

const deps = (overrides: Partial<QuotaDeps> = {}): QuotaDeps => ({
  engine: counting(0, { n: 0 }),
  projectWorkspace: async () => WORKSPACE,
  projectCreatedAt: async () => AT,
  workspaceEntitlement: async () => Entitlement.resolve("free", "active"),
  logger: silentLogger,
  deadline: Duration.seconds(5),
  ...overrides,
});

describe("the allowance", () => {
  test("well under the cap is allowed with the remainder", async () => {
    const quota = derivedIngestQuota(deps({ engine: counting(10, { n: 0 }) }));
    const verdict = await quota.check(PROJECT, 5, AT);
    // The free plan's allowance is 100,000 events a month.
    expect(verdict).toEqual({ kind: "Allowed", remaining: 100_000 - 15 });
  });

  /**
   * `overage` still accepts. Cutting a customer off at exactly 100% mid-month
   * loses data over a rounding error; the 30% band is the domain's decision and
   * this layer must not second-guess it.
   */
  test("just over the cap is still accepted", async () => {
    const quota = derivedIngestQuota(deps({ engine: counting(100_001, { n: 0 }) }));
    expect((await quota.check(PROJECT, 1, AT)).kind).toBe("Allowed");
  });

  test("past the overage band is refused as a plan cap", async () => {
    const quota = derivedIngestQuota(deps({ engine: counting(200_000, { n: 0 }) }));
    const verdict = await quota.check(PROJECT, 1, AT);
    expect(verdict.kind).toBe("PlanExceeded");
  });

  test("an unlimited plan needs no reading at all", async () => {
    const calls = { n: 0 };
    const quota = derivedIngestQuota(
      deps({
        engine: counting(0, calls),
        workspaceEntitlement: async () => ({
          plan: "pro",
          limits: { eventsPerMonth: null, projects: null, seats: null, retentionDays: null },
          inGrace: false,
        }),
      }),
    );
    expect(await quota.check(PROJECT, 1, AT)).toEqual({ kind: "Allowed", remaining: null });
    expect(calls.n).toBe(0);
  });
});

describe("the cache", () => {
  test("a second check inside the refresh window does not re-read", async () => {
    const calls = { n: 0 };
    const quota = derivedIngestQuota(deps({ engine: counting(10, calls) }));
    await quota.check(PROJECT, 1, AT);
    await quota.check(PROJECT, 1, Instant.plus(AT, Duration.seconds(5)));
    expect(calls.n).toBe(1);
  });

  test("a check past the refresh window reads again", async () => {
    const calls = { n: 0 };
    const quota = derivedIngestQuota(deps({ engine: counting(10, calls) }));
    await quota.check(PROJECT, 1, AT);
    await quota.check(PROJECT, 1, Instant.plus(AT, Duration.minutes(2)));
    expect(calls.n).toBe(2);
  });

  /**
   * The half that makes the cache safe. Without it, a customer one event under
   * their cap could send a million inside one refresh window and every one
   * would be admitted against the same stale reading.
   */
  test("recorded events advance the cached reading, so a burst still trips the cap", async () => {
    const quota = derivedIngestQuota(deps({ engine: counting(99_000, { n: 0 }) }));

    expect((await quota.check(PROJECT, 100, AT)).kind).toBe("Allowed");
    await quota.record(WORKSPACE, 100_000, AT, PROJECT);

    const after = await quota.check(PROJECT, 100, Instant.plus(AT, Duration.seconds(1)));
    expect(after.kind).toBe("PlanExceeded");
  });

  /**
   * `record` only advances an existing reading. Seeding one from nothing would
   * report a workspace's whole usage as the events this process happened to
   * see, which is wrong on every replica but the first.
   */
  test("recording against a workspace never read does not invent a reading", async () => {
    const calls = { n: 0 };
    const quota = derivedIngestQuota(deps({ engine: counting(10, calls) }));
    await quota.record(WORKSPACE, 1_000_000, AT, PROJECT);
    expect((await quota.check(PROJECT, 1, AT)).kind).toBe("Allowed");
    expect(calls.n).toBe(1);
  });
});

describe("the unclaimed path", () => {
  /**
   * An unauthenticated provisioning endpoint whose keys have no ceiling is free
   * unlimited storage for anyone who can run `curl` in a loop. Not zero either —
   * the whole point of the no-signup path is that the first event works.
   */
  test("an unclaimed project has a provisional allowance and then stops", async () => {
    const quota = derivedIngestQuota(
      deps({ projectWorkspace: async () => null, unclaimedAllowance: 10 }),
    );
    expect((await quota.check(PROJECT, 5, AT)).kind).toBe("Allowed");
    // Failed writes and retries that store nothing do not spend the allowance.
    expect((await quota.check(PROJECT, 5, AT)).kind).toBe("Allowed");
    await quota.record(WORKSPACE,5,AT,PROJECT);
    expect((await quota.check(PROJECT, 5, AT)).kind).toBe("Allowed");
    await quota.record(WORKSPACE,5,AT,PROJECT);
    expect((await quota.check(PROJECT, 1, AT)).kind).toBe("PlanExceeded");
  });
});

describe("when the reading fails", () => {
  /**
   * Refusing would take a customer's data away over an outage that is ours;
   * admitting costs us the overage on one refresh window. The failure is logged
   * so it is not silent.
   */
  test("an engine failure admits the batch and says so", async () => {
    const lines: string[] = [];
    const quota = derivedIngestQuota(
      deps({
        engine: unavailableEngine({}),
        logger: {
          debug: () => {}, info: () => {},
          warn: (message) => lines.push(message),
          error: () => {},
          with: () => silentLogger,
        },
      }),
    );
    expect(await quota.check(PROJECT, 1, AT)).toEqual({ kind: "Allowed", remaining: null });
    expect(lines).toEqual(["quota reading failed; admitting the batch"]);
  });

  /**
   * A key naming a project that no longer exists. `PlanExceeded` would say the
   * wrong thing entirely, so the honest instruction is a long backoff.
   */
  test("a project that no longer exists is rate-limited, not billed", async () => {
    const quota = derivedIngestQuota(deps({ projectWorkspace: async () => undefined }));
    expect(await quota.check(PROJECT, 1, AT)).toEqual({
      kind: "RateLimited",
      retryAfter: Duration.hours(1),
    });
  });
});
