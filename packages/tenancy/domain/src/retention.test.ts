import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "@counted/kernel";
import { Entitlement } from "./entitlement";
import { globalPurgeCutoff, longestRetentionDays, needsRowPurge, retentionCutoff } from "./retention";

const now = Instant.fromEpochMillis(1_700_000_000_000);

describe("what a plan keeps", () => {
  test("free events expire at 180 days, pro at 730", () => {
    expect(retentionCutoff(Entitlement.resolve("free", "active"), now)).toBe(
      Instant.minus(now, Duration.days(180)),
    );
    expect(retentionCutoff(Entitlement.resolve("pro", "active"), now)).toBe(
      Instant.minus(now, Duration.days(730)),
    );
  });

  test("an unlimited retention deletes nothing rather than everything", () => {
    const forever = Entitlement.resolve("pro", "active");
    const e = { ...forever, limits: { ...forever.limits, retentionDays: null } };
    expect(retentionCutoff(e, now)).toBeNull();
  });
});

describe("partitions are global and retention is per-plan", () => {
  test("a partition may only be dropped past the longest retention any plan grants", () => {
    expect(longestRetentionDays()).toBe(730);
    expect(globalPurgeCutoff(now)).toBe(Instant.minus(now, Duration.days(730)));
  });

  test("the shorter plan needs row-level purging, the longest one does not", () => {
    expect(needsRowPurge(Entitlement.resolve("free", "active"))).toBe(true);
    expect(needsRowPurge(Entitlement.resolve("pro", "active"))).toBe(false);
  });

  test("a plan that keeps events forever needs no row purge", () => {
    const pro = Entitlement.resolve("pro", "active");
    expect(needsRowPurge({ ...pro, limits: { ...pro.limits, retentionDays: null } })).toBe(false);
  });
});
