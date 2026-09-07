import { describe, expect, test } from "bun:test";
import {
  constantTimeEquals,
  hmacSha256Base64,
  hmacSha256Hex,
  sha256Base64Url,
  sha256Hex,
} from "./digest";
import { newShareToken, shareTokenDigest } from "./share-token";
import { randomToken } from "./random";

describe("sha256", () => {
  test("matches the published digest of the empty string", () => {
    // A known-answer test. Without one, a hashing bug produces output that
    // looks exactly like correct output.
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("base64url output contains nothing a URL would re-encode", () => {
    // A digest that gets percent-encoded on one path and not another stops
    // matching itself, and the share link 404s for reasons nobody can see.
    for (let i = 0; i < 200; i += 1) {
      expect(sha256Base64Url(randomToken(32))).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("hmacSha256", () => {
  test("matches RFC 4231 test case 2", () => {
    expect(hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  test("a different key over the same message gives a different tag", () => {
    expect(hmacSha256Base64("k1", "payload")).not.toBe(hmacSha256Base64("k2", "payload"));
  });
});

describe("constantTimeEquals", () => {
  test("is true only for identical strings", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
  });

  test("returns false for different lengths instead of throwing", () => {
    // node's timingSafeEqual throws on a length mismatch. The naive wrapper
    // turns a wrong-length guess into a 500 and a right-length guess into a
    // 401 — a length oracle built out of the function meant to prevent one.
    expect(() => constantTimeEquals("short", "considerably longer")).not.toThrow();
    expect(constantTimeEquals("short", "considerably longer")).toBe(false);
    expect(constantTimeEquals("", "x")).toBe(false);
  });

  test("handles multi-byte characters without a length mismatch of its own", () => {
    expect(constantTimeEquals("café", "café")).toBe(true);
    expect(constantTimeEquals("café", "cafe")).toBe(false);
  });
});

describe("share tokens", () => {
  test("the digest is not the token", () => {
    // The property the whole scheme rests on: a dump of the dashboards table
    // contains no working share link.
    const token = newShareToken();
    expect(shareTokenDigest(token)).not.toBe(token);
  });

  test("the same token always digests to the same value", () => {
    const token = newShareToken();
    expect(shareTokenDigest(token)).toBe(shareTokenDigest(token));
  });

  test("distinct tokens digest distinctly", () => {
    const digests = new Set(Array.from({ length: 2_000 }, () => shareTokenDigest(newShareToken())));
    expect(digests.size).toBe(2_000);
  });

  test("tokens are URL-safe and carry 256 bits", () => {
    const token = newShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url").length).toBe(32);
  });
});
