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
    const locations = [...source.matchAll(/redirectTo\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    expect(locations.length).toBeGreaterThan(2);
    for (const l of locations) expect(l).toMatch(/^\//);
  });

  test("passes the API's Set-Cookie through untouched", () => {
    // Re-deriving Domain/SameSite/Max-Age here is how the two implementations
    // would come to disagree about what a session is.
    expect(source).toMatch(/set-cookie/i);
    expect(source).not.toMatch(/Domain=|SameSite=|Max-Age=/);
  });
});
