/**
 * Every internal link points at a route this app serves.
 *
 * `/login` was linked from eleven files — the primary call to action on the
 * homepage, the pricing page, every `/vs/*` comparison, the blog footer, the
 * docs header and the site nav — and no route has ever served it. The route is
 * `/sign-in`. Every marketing CTA was a 404, which is the single worst place
 * for one: the click that a launch exists to produce.
 *
 * It cost twice over. `TrackedCTA` appended first-touch attribution only to
 * hrefs starting `/login`, so the attribution meant to survive the hop into the
 * console fired for nothing. One stale literal, two silent failures.
 *
 * This is the same defect the API side has now hit three times —
 * `/v1/openapi.json`, `/index.md`, and the 401 `resource_metadata` — always one
 * place promising and another failing to keep it. Here the promise is an
 * `href` and the keeper is the route tree, so this compares them.
 *
 * Only same-origin links. Absolute URLs are somebody else's routing table, and
 * checking them would mean network calls in a unit test.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP = import.meta.dir;
const SRC = join(APP, "..");

/** Routes this app serves, with `(groups)` removed — they add no path segment. */
const servedRoutes = (): Set<string> => {
  const routes = new Set<string>(["/"]);
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules") continue;
      const segment =
        entry.name.startsWith("(") && entry.name.endsWith(")") ? prefix : `${prefix}/${entry.name}`;
      const full = join(dir, entry.name);
      for (const file of ["page.tsx", "route.ts"]) {
        try {
          statSync(join(full, file));
          routes.add(segment === "" ? "/" : segment);
        } catch {
          /* not a route */
        }
      }
      walk(full, segment);
    }
  };
  walk(APP, "");
  return routes;
};

/** Same-origin hrefs, from code only — a comment naming a path is not a link. */
const internalLinks = (): Map<string, Set<string>> => {
  const links = new Map<string, Set<string>>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;

      const code = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      for (const match of code.matchAll(/href="(\/[^"]*)"/g)) {
        const href = (match[1] ?? "").split(/[?#]/)[0] ?? "";
        const path = href.length > 1 ? href.replace(/\/$/, "") : href;
        if (path.startsWith("/_next")) continue;
        if (!links.has(path)) links.set(path, new Set());
        links.get(path)?.add(full.slice(SRC.length + 1));
      }
    }
  };
  walk(SRC);
  return links;
};

const matches = (href: string, routes: Set<string>): boolean =>
  routes.has(href) ||
  [...routes].some((route) =>
    new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+").replace(/[.+?^${}()|]/g, "\\$&")}$`).test(href),
  );

describe("internal links", () => {
  const routes = servedRoutes();
  const links = internalLinks();

  test("the scan found routes and links, so it cannot pass by finding nothing", () => {
    expect(routes.size).toBeGreaterThan(15);
    expect(links.size).toBeGreaterThan(8);
  });

  test("every internal href resolves to a served route", () => {
    const broken = [...links.entries()]
      .filter(([href]) => !matches(href, routes))
      .map(([href, files]) => `${href} <- ${[...files].sort().join(", ")}`);

    expect(broken).toEqual([]);
  });

  test("the sign-in CTA carries attribution, and matches the route it links to", () => {
    // These two literals have to agree or attribution silently stops. They
    // disagreed with the route tree and with nothing else, which is why the
    // breakage was invisible.
    const track = readFileSync(join(APP, "(marketing)", "track.tsx"), "utf8");
    const guard = /href\.startsWith\("([^"]+)"\)/.exec(track);
    expect(guard?.[1]).toBeDefined();
    expect(matches(guard?.[1] ?? "", routes)).toBe(true);
  });
});
