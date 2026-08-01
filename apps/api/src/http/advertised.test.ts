/**
 * Every URL the API advertises must be a route the API serves.
 *
 * This is the third time the same defect has landed. `/v1/openapi.json` was
 * named in the `Link` header of every 410 from the compat edge and in the docs
 * while resolving nowhere. The homepage advertised a `text/markdown` alternate
 * at `/index.md` that was never ported to v2. And every 401 carried
 * `resource_metadata="https://counted.dev/.well-known/oauth-protected-resource"`
 * — wrong host, and no document behind it on either host.
 *
 * The pattern is always the same: one place makes a promise, another place is
 * supposed to keep it, and nothing compares them. So this compares them.
 *
 * A dead advertised URL is worse than silence. Silence tells an agent to look
 * elsewhere; a 404 tells it the thing exists and that it failed to fetch it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROUTES_DIR = join(import.meta.dir, "..", "routes");

/** Absolute counted.dev URLs promised anywhere in the API source. */
const advertisedApiUrls = (): string[] => {
  const found = new Set<string>();
  const files = [
    ...readdirSync(ROUTES_DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(ROUTES_DIR, f)),
    join(import.meta.dir, "respond.ts"),
  ];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // Only api.counted.dev — paths on counted.dev are the web app's to serve,
    // and asserting them here would fail for reasons this suite cannot fix.
    for (const m of src.matchAll(/https:\/\/api\.counted\.dev(\/[A-Za-z0-9._~/-]*)/g)) {
      const path = m[1];
      if (path !== undefined && path !== "/") found.add(path);
    }
  }
  return [...found];
};

/** Paths the API declares as routes. */
const declaredPaths = (): Set<string> => {
  const paths = new Set<string>();
  for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const src = readFileSync(join(ROUTES_DIR, file), "utf8");
    for (const m of src.matchAll(/path:\s*"([^"]+)"/g)) {
      const p = m[1];
      if (p !== undefined) paths.add(p);
    }
  }
  return paths;
};

describe("advertised URLs", () => {
  const declared = declaredPaths();
  const advertised = advertisedApiUrls();

  test("the scan found routes and promises, so it cannot pass by finding nothing", () => {
    expect(declared.size).toBeGreaterThan(8);
    expect(advertised.length).toBeGreaterThan(0);
  });

  test("every api.counted.dev URL the API advertises is a route it serves", () => {
    // Parameterised routes are compared by shape, not by literal text.
    const matches = (url: string): boolean =>
      [...declared].some((p) => new RegExp(`^${p.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(url));

    const dead = advertised.filter((u) => !matches(u));
    expect(dead).toEqual([]);
  });

  test("the 401 challenge names the resource server, not the marketing host", () => {
    const respond = readFileSync(join(import.meta.dir, "respond.ts"), "utf8");
    expect(respond).toMatch(/resource_metadata="https:\/\/api\.counted\.dev\//);
    expect(respond).not.toMatch(/resource_metadata="https:\/\/counted\.dev\//);
  });
});
