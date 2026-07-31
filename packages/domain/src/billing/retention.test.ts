import { describe, expect, test } from "bun:test";
import {
  Duration,
  Entitlement,
  Instant,
  PlanCatalog,
  globalPurgeCutoff,
  longestRetentionDays,
  needsRowPurge,
  retentionCutoff,
} from "../index";

const now = Instant.fromEpochMillis(Date.parse("2026-03-17T15:00:00.000Z"));
const daysBefore = (n: number) => Instant.minus(now, Duration.days(n));

describe("a cutoff is the plan's retention, counted back from now", () => {
  test("free keeps six months", () => {
    // The number on the pricing page, which until now described nothing.
    const cutoff = retentionCutoff(Entitlement.none(), now);
    expect(cutoff).toBe(daysBefore(180));
  });

  test("pro keeps two years", () => {
    const cutoff = retentionCutoff(Entitlement.resolve("pro", "active"), now);
    expect(cutoff).toBe(daysBefore(730));
  });

  test("a past_due workspace keeps its plan's retention", () => {
    // Same rule the rest of the system applies. Shortening someone's retention
    // because a card expired would delete data over a billing hiccup.
    expect(retentionCutoff(Entitlement.resolve("pro", "past_due"), now)).toBe(daysBefore(730));
  });

  test("a canceled subscription falls back to the free retention", () => {
    expect(retentionCutoff(Entitlement.resolve("pro", "canceled"), now)).toBe(daysBefore(180));
  });

  test("an unlimited retention is null, meaning delete nothing", () => {
    // Callers must read this as "keep indefinitely", never as "delete now" —
    // which is why it is null rather than zero or the epoch.
    const unlimited: Entitlement = {
      plan: "pro",
      limits: { ...PlanCatalog.limitsFor("pro"), retentionDays: null },
      inGrace: false,
    };
    expect(retentionCutoff(unlimited, now)).toBeNull();
  });

  test("the cutoff is in the past, always", () => {
    for (const plan of ["free", "pro"] as const) {
      const cutoff = retentionCutoff(Entitlement.resolve(plan, "active"), now)!;
      expect(Instant.toEpochMillis(cutoff)).toBeLessThan(Instant.toEpochMillis(now));
    }
  });
});

describe("a partition may only be dropped once it is expired for everyone", () => {
  test("the global cutoff is the longest retention any plan grants", () => {
    // Dropping at the free cutoff would delete a paying customer's data along
    // with a free workspace's, and a dropped partition is not recoverable.
    expect(longestRetentionDays()).toBe(730);
    expect(globalPurgeCutoff(now)).toBe(daysBefore(730));
  });

  test("it is older than any individual plan's cutoff", () => {
    const global = globalPurgeCutoff(now)!;
    for (const plan of ["free", "pro"] as const) {
      const mine = retentionCutoff(Entitlement.resolve(plan, "active"), now)!;
      expect(Instant.toEpochMillis(global)).toBeLessThanOrEqual(Instant.toEpochMillis(mine));
    }
  });
});

describe("which plans still need row-level purging", () => {
  test("free does, because its retention is shorter than the longest", () => {
    // Its events between six months and two years sit inside partitions a
    // paying customer still needs, so they cannot go with the month.
    expect(needsRowPurge(Entitlement.none())).toBe(true);
  });

  test("the longest plan does not — dropping its months is enough", () => {
    expect(needsRowPurge(Entitlement.resolve("pro", "active"))).toBe(false);
  });

  test("an unlimited plan never needs purging", () => {
    const unlimited: Entitlement = {
      plan: "pro",
      limits: { ...PlanCatalog.limitsFor("pro"), retentionDays: null },
      inGrace: false,
    };
    expect(needsRowPurge(unlimited)).toBe(false);
  });

  test("every plan that needs purging has a cutoff to purge at", () => {
    // Otherwise the handler would decide to purge and then have no instant to
    // purge before, which would be a silent no-op.
    for (const plan of ["free", "pro"] as const) {
      const entitlement = Entitlement.resolve(plan, "active");
      if (needsRowPurge(entitlement)) expect(retentionCutoff(entitlement, now)).not.toBeNull();
    }
  });
});

describe("the two mechanisms cover the whole timeline between them", () => {
  test("nothing older than a plan's retention survives both phases", () => {
    // Free data at 200 days: past its own cutoff (180) so the row purge takes
    // it, and not yet past the global one (730) so the partition is still
    // there. This is exactly the gap that partition drops alone would miss.
    const free = Entitlement.none();
    const event = daysBefore(200);
    const own = retentionCutoff(free, now)!;
    const global = globalPurgeCutoff(now)!;

    expect(Instant.toEpochMillis(event)).toBeLessThan(Instant.toEpochMillis(own));
    expect(Instant.toEpochMillis(event)).toBeGreaterThan(Instant.toEpochMillis(global));
    expect(needsRowPurge(free)).toBe(true);
  });

  test("data inside a plan's retention is past neither cutoff", () => {
    const event = daysBefore(90);
    expect(Instant.toEpochMillis(event)).toBeGreaterThan(
      Instant.toEpochMillis(retentionCutoff(Entitlement.none(), now)!),
    );
  });
});
