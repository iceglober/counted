import { describe, expect, test } from "bun:test";
import { suggestedProjectName, SUGGESTED_NAME_COMBINATIONS } from "./suggested-name";

describe("suggested project name", () => {
  test("is two plain words, hyphenated", () => {
    // The contract's name field is min 1 / max 100; this must always fit, and
    // must never need escaping in a URL, a heading, or a nav.
    for (let i = 0; i < 200; i += 1) {
      const name = suggestedProjectName();
      expect(name).toMatch(/^[a-z]+-[a-z]+$/);
      expect(name.length).toBeGreaterThan(1);
      expect(name.length).toBeLessThanOrEqual(100);
    }
  });

  test("is deterministic given a source of randomness", () => {
    // Injected rather than reading Math.random directly, so the domain keeps
    // its no-ambient-dependencies rule and this is testable without stubbing a
    // global.
    const first = suggestedProjectName(() => 0);
    expect(suggestedProjectName(() => 0)).toBe(first);
    expect(suggestedProjectName(() => 0.999)).not.toBe(first);
  });

  test("draws on a pool wide enough that a collision is unremarkable", () => {
    expect(SUGGESTED_NAME_COMBINATIONS).toBeGreaterThan(500);
    const seen = new Set(Array.from({ length: 300 }, () => suggestedProjectName()));
    expect(seen.size).toBeGreaterThan(100);
  });

  test("never suggests the placeholder it replaces", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(suggestedProjectName().toLowerCase()).not.toContain("untitled");
    }
  });
});
