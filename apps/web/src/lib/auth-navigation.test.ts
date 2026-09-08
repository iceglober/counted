import { describe, expect, test } from "bun:test";
import { safeNext, signInPath } from "./auth-navigation";

describe("authentication continuation", () => {
  test("keeps a nested invitation or application destination", () => {
    const path = "/w/abc/settings?tab=plan#upgrade";
    expect(safeNext(path)).toBe(path);
    expect(new URL(signInPath(path), "https://app.test").searchParams.get("next")).toBe(path);
    expect(safeNext("/invitations/a%20b")).toBe("/invitations/a%20b");
  });
  test("rejects external, ambiguous, and mutating auth destinations", () => {
    for (const path of ["https://evil.test", "//evil.test", "/\\evil.test", "/\n/evil.test", "/api/auth/sign-out", "/sign-in?next=/", undefined, ["/"]]) {
      expect(safeNext(path)).toBe("/");
    }
  });
});
