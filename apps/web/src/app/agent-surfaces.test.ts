/**
 * The agent-facing surfaces exist, and say something.
 *
 * These files have no UI and no user who notices when they break. A route that
 * silently stops being built, or degrades to a heading with nothing under it,
 * looks identical to a working one from inside the app — the only symptom is
 * an agent quietly choosing a different product.
 *
 * The recurring failure this guards is narrower and worse than "missing":
 * advertising a URL that does not resolve. `/index.md` was linked from the
 * homepage for the whole of v2 without the route existing, `/v1/openapi.json`
 * was named in `Link` headers that resolved nowhere, and every 401 pointed at
 * a `resource_metadata` document on the wrong host that was never served. A
 * dead advertised URL is worse than silence: silence says look elsewhere, a
 * 404 says this is broken.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const APP = import.meta.dir;

/** Each agent surface, with the substance it must actually carry. */
const SURFACES = [
  { route: "llms.txt", minChars: 400, mustContain: ["# Counted", "When to use"] },
  { route: "index.md", minChars: 400, mustContain: ["# Counted"] },
  { route: "pricing.md", minChars: 300, mustContain: ["# Counted pricing", "100,000", "1,000,000"] },
  { route: "auth.md", minChars: 800, mustContain: ["# Authenticating", "Bearer", "provision"] },
  { route: ".well-known/api-catalog", minChars: 200, mustContain: ["linkset", "service-desc"] },
] as const;

describe("agent surfaces", () => {
  for (const s of SURFACES) {
    test(`/${s.route} exists and has real content`, () => {
      const file = join(APP, s.route, "route.ts");
      expect(existsSync(file)).toBe(true);

      const src = readFileSync(file, "utf8");
      for (const needle of s.mustContain) expect(src).toContain(needle);

      // A placeholder — a heading and nothing else — earns nothing and reads
      // to a scanner as a broken surface rather than an absent one.
      const literal = src.slice(src.indexOf("`"), src.lastIndexOf("`"));
      expect(literal.length).toBeGreaterThan(s.minChars);
    });
  }

  test("markdown surfaces declare a markdown content type", () => {
    for (const route of ["index.md", "pricing.md", "auth.md"]) {
      const src = readFileSync(join(APP, route, "route.ts"), "utf8");
      expect(src).toContain("text/markdown");
    }
  });

  test("the homepage only advertises the markdown alternate because the route exists", () => {
    const page = readFileSync(join(APP, "(marketing)", "page.tsx"), "utf8");
    if (page.includes('"text/markdown"')) {
      expect(existsSync(join(APP, "index.md", "route.ts"))).toBe(true);
    }
  });

  test("Link headers only name paths that are served", () => {
    const config = readFileSync(join(APP, "..", "..", "next.config.ts"), "utf8");
    const advertised = [...config.matchAll(/<\/([A-Za-z0-9._/-]+)>/g)].map((m) => m[1]);
    expect(advertised.length).toBeGreaterThan(0);

    for (const path of advertised) {
      if (path === undefined) continue;
      if (path === "sitemap.xml") {
        expect(existsSync(join(APP, "sitemap.ts"))).toBe(true);
        continue;
      }
      expect(existsSync(join(APP, path, "route.ts"))).toBe(true);
    }
  });

  test("the homepage renders the JSON-LD entities that were written for it", () => {
    const page = readFileSync(join(APP, "(marketing)", "page.tsx"), "utf8");
    // These existed as exports and were rendered nowhere, which is why
    // `sameAs`, `speakable` and `applicationCategory` were all reported absent.
    for (const entity of ["organizationLd", "websiteLd", "softwareApplicationLd"]) {
      expect(page).toContain(`data={${entity}}`);
    }
  });
});
