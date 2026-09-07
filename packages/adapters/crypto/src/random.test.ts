import { describe, expect, test } from "bun:test";
import { randomBytes, randomInt, randomToken } from "./random";

describe("randomToken", () => {
  test("is unique across a large batch", () => {
    const tokens = new Set(Array.from({ length: 10_000 }, () => randomToken(32)));
    expect(tokens.size).toBe(10_000);
  });

  test("carries the entropy it was asked for", () => {
    expect(Buffer.from(randomToken(16), "base64url").length).toBe(16);
    expect(Buffer.from(randomToken(64), "base64url").length).toBe(64);
  });

  test("is unpadded, so it never grows an = that a URL would encode", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(randomToken(31)).not.toContain("=");
    }
  });
});

describe("randomInt", () => {
  test("stays inside the half-open range", () => {
    for (let i = 0; i < 5_000; i += 1) {
      const n = randomInt(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });

  test("covers the whole range rather than a prefix of it", () => {
    // `randomBytes(4) % n` is the tempting version and it is biased whenever n
    // is not a power of two. This does not prove uniformity, but it does catch
    // an implementation that never reaches the top of the range.
    const seen = new Set(Array.from({ length: 5_000 }, () => randomInt(7)));
    expect(seen.size).toBe(7);
  });
});

describe("randomBytes", () => {
  test("returns the requested width", () => {
    expect(randomBytes(24).length).toBe(24);
  });
});
