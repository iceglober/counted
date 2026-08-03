/**
 * The sign-in callback must not reconstruct its own origin.
 *
 * It used `new URL(path, request.url)` to build every redirect, and inside the
 * container `request.url` carries the bind address — so a real sign-in landed
 * the user on `http://0.0.0.0:3000/`, with the session cookie set against a
 * page that cannot load. The bad token was a red herring: the redirect was
 * broken for the success path too.
 *
 * This is the only handler in the app that ever built an absolute redirect.
 * Every other one calls `redirect("/sign-in")` from `next/navigation`, which
 * emits a relative location and cannot have this bug. So the assertion is
 * narrow on purpose: no absolute redirect anywhere in this file.
 *
 * A relative `Location` is legal (RFC 9110 §10.2.2) and the browser resolves it
 * against the URL it actually visited, which is the public one by
 * construction. It cannot name the wrong host because it names no host.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "route.ts"), "utf8");

describe("sign-in callback", () => {
  test("never builds a redirect target from request.url", () => {
    // `new URL(request.url)` for *reading* the token is fine; what must not
    // come back is a second argument making it a base for a redirect.
    expect(source).not.toMatch(/new URL\(\s*["'`][^"'`]*["'`]\s*,\s*request\.url/);
  });

  test("does not trust a forwarded host header either", () => {
    // The other tempting fix; it works until something in front rewrites it.
    // Matches an actual header read rather than the word, because the comment
    // above `redirectTo` names the header in order to rule it out.
    expect(source).not.toMatch(/\.get\(\s*["'`]x-forwarded-(host|proto)/i);
  });

  test("every redirect location is a relative path", () => {
    // Covers both forms: the redirectTo() helper and the success path, which
    // builds its own Headers so it can append two Set-Cookies.
    const literals = [
      ...[...source.matchAll(/redirectTo\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]),
      ...[...source.matchAll(/location:\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]),
      ...[...source.matchAll(/\?\s*decoded\s*:\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]),
    ];
    expect(literals.length).toBeGreaterThan(2);
    for (const l of literals) expect(l).toMatch(/^\//);
  });

  test("a caller-supplied redirect target is re-validated here, not trusted", () => {
    // The destination arrives in a cookie, which the caller can write. Both the
    // same-origin rule and the protocol-relative guard must be applied in this
    // file, not only where the cookie was set.
    expect(source).toMatch(/startsWith\("\/"\)/);
    expect(source).toMatch(/startsWith\("\/\/"\)/);
  });

  test("lands a signed-in account in the console, not on the marketing page", () => {
    // This app serves counted.dev *and* app.counted.dev, so "/" is the
    // marketing homepage. Redirecting there on success dropped the user on the
    // landing page with a session cookie set and nothing to show for it.
    expect(source).not.toMatch(/redirectTo\(\s*["'`]\/["'`]/);
    // The default destination is now the fallback of the `next` ternary rather
    // than a redirectTo literal; it must still be a console route.
    expect(source).toMatch(/["'`]\/(dashboards|start)\b/);
  });

  test("no console page bounces to the marketing homepage", () => {
    // `/dashboards` did the same thing when no workspace was named, so a
    // signed-in account could not reach the console from either direction.
    const consoleDir = join(import.meta.dir, "..", "..");
    for (const page of ["dashboards/page.tsx", "projects/page.tsx", "settings/page.tsx"]) {
      let src: string;
      try {
        src = readFileSync(join(consoleDir, page), "utf8");
      } catch {
        continue; // page may not exist yet
      }
      // Comments may discuss it; code may not do it.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/redirect\(\s*["'`]\/["'`]\s*\)/);
    }
  });

  test("passes the API's Set-Cookie through untouched", () => {
    // Re-deriving Domain/SameSite/Max-Age here is how the two implementations
    // would come to disagree about what a session is.
    expect(source).toMatch(/set-cookie/i);
    // The session cookie is forwarded verbatim: it is only ever read from the
    // API response and appended, never constructed.
    expect(source).toMatch(/response\.headers\.get\("set-cookie"\)/);
    expect(source).not.toMatch(/counted_session/);
    // The one cookie this file writes is the `next` breadcrumb, and only to
    // expire it. Any Domain= or a Max-Age on anything else would mean it had
    // started minting session state of its own.
    const written = [...source.matchAll(/"([a-z_]+)=[^"]*Max-Age=[^"]*"/g)].map((m) => m[1]);
    expect(written).toEqual(["counted_next"]);
    expect(source).not.toMatch(/Domain=/);
  });
});
