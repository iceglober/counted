/**
 * robots.txt advertises the sitemap; sitemap.ts serves it. That is one fact
 * written in two files, and the way this pair drifts is silent — robots keeps
 * naming a URL that moved, and the only symptom is crawlers never finding the
 * sitemap at all.
 *
 * The `Sitemap:` line was absent entirely until this test existed. `sitemap.ts`
 * had already shipped, so the sitemap was live and unadvertised: discoverable
 * only by whoever submitted it to Search Console by hand.
 */

import { describe, expect, test } from "bun:test";
import robots, { SITEMAP_URL } from "./robots";
import { SITE_URL } from "../lib/urls";

describe("robots.txt points at a sitemap that exists", () => {
  test("it declares one at all", () => {
    expect(robots().sitemap).toBe(SITEMAP_URL);
  });

  test("the URL is the route sitemap.ts actually serves", () => {
    // Next.js serves `app/sitemap.ts` at exactly /sitemap.xml. Hard-coded here
    // rather than derived, so renaming the route breaks this test instead of
    // quietly changing what robots.txt promises.
    expect(SITEMAP_URL).toBe(`${SITE_URL}/sitemap.xml`);
  });

  test("it is absolute — a relative Sitemap line is ignored by crawlers", () => {
    expect(SITEMAP_URL).toMatch(/^https?:\/\//);
  });

  test("the disallowed capability paths are still disallowed", () => {
    // The sitemap must never contradict these; `sitemap.test.ts` owns that side.
    const disallow = robots().rules;
    const rule = Array.isArray(disallow) ? disallow[0] : disallow;
    expect(rule?.disallow).toEqual(["/share/", "/bff/", "/claim/"]);
  });
});
