/**
 * The sitemap lists public routes by hand. The app directory *is* the list of
 * routes. Two descriptions of one set drift, and the way this pair drifts is
 * silent: a new marketing page ships, nothing tells Google it exists, and the
 * only symptom is a page that never ranks.
 *
 * So this compares them mechanically rather than asking anyone to remember.
 *
 * v2 shipped with no sitemap at all — v1 had one and it was never ported —
 * which is what put seventeen pages in Search Console's "Discovered – currently
 * not indexed". That was invisible in every test because the file simply was
 * not there.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_ROUTES } from "./sitemap";

const APP_DIR = import.meta.dir;

/** Route groups `(marketing)` add no path segment; dynamic ones are not static pages. */
const routesFromDisk = (dir: string, prefix = ""): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith("[") || entry.startsWith("_")) continue;
    const segment = entry.startsWith("(") && entry.endsWith(")") ? prefix : `${prefix}/${entry}`;
    try {
      statSync(join(full, "page.tsx"));
      out.push(segment === "" ? "/" : segment);
    } catch {
      /* directory with no page of its own */
    }
    out.push(...routesFromDisk(full, segment));
  }
  return out;
};

/**
 * Everything behind auth or holding a capability. These must never be
 * submitted: the console routes redirect a crawler to sign-in, and `claim`
 * and `share` are capability URLs that `robots.ts` already disallows.
 */
const NOT_PUBLIC = new Set(["/projects", "/dashboards", "/settings", "/sign-in", "/start"]);

describe("sitemap", () => {
  const onDisk = new Set(routesFromDisk(APP_DIR).concat("/"));
  const listed = new Set(PUBLIC_ROUTES.map((r) => r.path));

  test("every public page on disk is in the sitemap", () => {
    const missing = [...onDisk].filter((r) => !listed.has(r) && !NOT_PUBLIC.has(r));
    expect(missing).toEqual([]);
  });

  test("every sitemap entry is a page that exists", () => {
    const dangling = [...listed].filter((r) => !onDisk.has(r));
    expect(dangling).toEqual([]);
  });

  test("no authenticated or capability route is submitted", () => {
    const leaked = [...listed].filter((r) => NOT_PUBLIC.has(r) || /\/(claim|share)\b/.test(r));
    expect(leaked).toEqual([]);
  });

  test("the crawl found real routes, so an empty scan cannot pass silently", () => {
    expect(onDisk.size).toBeGreaterThan(8);
  });
});
