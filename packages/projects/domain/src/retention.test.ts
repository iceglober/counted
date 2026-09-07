import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "@counted/kernel";
import {
  effectiveRetentionDays,
  MAX_RETENTION_DAYS,
  RETENTION_INHERIT,
  retentionCutoff,
  retentionEquals,
  retentionPolicy,
} from "./retention";

const NOW = Instant.fromEpochMillis(1_700_000_000_000);

describe("retention", () => {
  test("a project may keep less than its plan allows, never more", () => {
    // The clamp is applied on read, not on write. A downgrade must shorten
    // retention immediately — not the next time somebody edits the field,
    // which is the version where a cancelled customer's data lives for a year.
    const pinned = retentionPolicy(400);
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) throw new Error("unreachable");
    expect(effectiveRetentionDays(pinned.value, 180)).toBe(180);
    expect(effectiveRetentionDays(pinned.value, 730)).toBe(400);
  });

  test("inherit means exactly what the plan says, including forever", () => {
    expect(effectiveRetentionDays(RETENTION_INHERIT, 180)).toBe(180);
    expect(effectiveRetentionDays(RETENTION_INHERIT, null)).toBeNull();
  });

  test("a project can pin a window under an unlimited plan", () => {
    const pinned = retentionPolicy(30);
    if (!pinned.ok) throw new Error("unreachable");
    expect(effectiveRetentionDays(pinned.value, null)).toBe(30);
  });

  test("null means delete nothing, and the cutoff says so rather than returning now", () => {
    // The direction this null gets got wrong: read as 'delete everything before
    // now' it purges the entire dataset of every unlimited-plan customer.
    expect(retentionCutoff(RETENTION_INHERIT, null, NOW)).toBeNull();
  });

  test("the cutoff is exactly that many 24-hour days back", () => {
    const cutoff = retentionCutoff(RETENTION_INHERIT, 30, NOW);
    expect(cutoff).toBe(Instant.minus(NOW, Duration.days(30)));
  });

  test("refuses zero, fractions, negatives and absurd values", () => {
    // Zero is not a retention setting, it is a broken project. A fraction would
    // make two purge runs disagree about the same row.
    for (const days of [0, -1, 0.5, 1.5, MAX_RETENTION_DAYS + 1, Number.NaN]) {
      expect(retentionPolicy(days)).toEqual({ ok: false, error: { kind: "InvalidRetention", days } });
    }
    expect(retentionPolicy(1).ok).toBe(true);
    expect(retentionPolicy(MAX_RETENTION_DAYS).ok).toBe(true);
  });

  test("equality distinguishes inherit from a pinned value", () => {
    const thirty = retentionPolicy(30);
    const sixty = retentionPolicy(60);
    if (!thirty.ok || !sixty.ok) throw new Error("unreachable");
    expect(retentionEquals(RETENTION_INHERIT, RETENTION_INHERIT)).toBe(true);
    expect(retentionEquals(RETENTION_INHERIT, thirty.value)).toBe(false);
    expect(retentionEquals(thirty.value, thirty.value)).toBe(true);
    expect(retentionEquals(thirty.value, sixty.value)).toBe(false);
  });
});
