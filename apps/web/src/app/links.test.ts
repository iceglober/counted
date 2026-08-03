/**
 * `next/link` is for routes this app owns. Anything else is an `<a>`.
 *
 * The landing page's "Open your live dashboard" used `<Link href={claimUrl}>`,
 * and `claimUrl` is absolute — the API builds it from `APP_URL`, so in
 * production it points at `app.counted.dev` while the page rendering it is
 * served from `counted.dev`. Different origin. It looked correct in development
 * only because both hosts are one port there, which is exactly the kind of bug
 * a local test cannot see.
 *
 * The reported symptom was a first click that closed the panel and went
 * nowhere, with a second attempt working — a router transition that cannot
 * resolve its target.
 *
 * There is a second reason beyond routing: `next/link` prefetches. The claim URL
 * is a capability URL, so a prefetch fetches somebody's claim link on hover,
 * before they choose to open it. A preview consumes nothing, but it is still a
 * request the person did not make, and the same mistake on a URL that *is*
 * consumed would spend it.
 *
 * So the rule is about the value, not the component: a `Link` href must resolve
 * to a path this app routes. A variable holding a URL from the API does not
 * qualify.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..");

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : files(full);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

/** Names known to hold a URL produced elsewhere — absolute, not a route. */
const EXTERNAL_VALUES = /\b(claimUrl|shareUrl|apiUrl|API_URL|SITE_URL|endpoint|url)\b/;

describe("next/link is only used for internal routes", () => {
  const sources = files(SRC).map((f) => ({ file: f.slice(SRC.length + 1), src: readFileSync(f, "utf8") }));

  test("the scan found the components that use Link", () => {
    expect(sources.filter((s) => s.src.includes("next/link")).length).toBeGreaterThan(3);
  });

  test("no Link href is a literal absolute URL", () => {
    const offenders = sources.flatMap(({ file, src }) =>
      [...src.matchAll(/<Link[^>]*href=\{?["'`](https?:\/\/[^"'`]+)["'`]/g)].map((m) => `${file}: ${m[1]}`),
    );
    expect(offenders).toEqual([]);
  });

  test("no Link href is a variable holding an API-built URL", () => {
    // `<Link href={result.claimUrl}>` — the actual bug. The href is a value the
    // API produced, so it is absolute and may be cross-origin.
    const offenders = sources.flatMap(({ file, src }) =>
      [...src.matchAll(/<Link[^>]*href=\{([^}]+)\}/g)]
        .filter((m) => EXTERNAL_VALUES.test(m[1] ?? ""))
        .map((m) => `${file}: href={${(m[1] ?? "").trim()}}`),
    );
    expect(offenders).toEqual([]);
  });

  test("the claim link specifically is an anchor", () => {
    // Named because it is the one that shipped broken, and because a general
    // rule would also pass if somebody deleted the link rather than fixing it.
    const cta = sources.find((s) => s.file.endsWith("landing-cta.tsx"));
    expect(cta).toBeDefined();
    expect(cta?.src).toMatch(/<a href=\{result\.claimUrl\}/);
  });
});
