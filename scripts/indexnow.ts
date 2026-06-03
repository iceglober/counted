#!/usr/bin/env bun
/**
 * Submit all public URLs to IndexNow (Bing / Yandex / IndexNow network) for
 * instant indexing. Run on publish, or manually:
 *
 *   bun scripts/indexnow.ts            # submit everything
 *   bun scripts/indexnow.ts --dry-run  # print the URL list, don't submit
 *
 * Idempotent — resubmitting known URLs is fine. Keep the sitemap and this list
 * in sync (both derive blog posts from the posts registry).
 */
export {};

import { INDEXNOW_KEY, INDEXNOW_SITE, INDEXNOW_KEY_LOCATION } from "../lib/indexnow";
import { POSTS } from "../app/(marketing)/blog/posts";

const STATIC_PAGES = ["/", "/pricing", "/vs/aptabase", "/vs/posthog", "/vs/plausible", "/for/agents", "/blog", "/privacy", "/terms"];

const urlList = [
  ...STATIC_PAGES,
  ...POSTS.map((p) => `/blog/${p.slug}`),
].map((path) => `${INDEXNOW_SITE}${path}`);

const dryRun = process.argv.includes("--dry-run");

console.log(`IndexNow: ${urlList.length} URLs for ${new URL(INDEXNOW_SITE).host}`);
for (const u of urlList) console.log(`  ${u}`);

if (dryRun) {
  console.log("\n[dry-run] not submitted.");
  process.exit(0);
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: new URL(INDEXNOW_SITE).host,
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList,
  }),
});

// IndexNow returns 200 (accepted) or 202 (accepted, pending). 403 = key file
// not reachable; 422 = URLs don't match host.
console.log(`\nIndexNow response: ${res.status} ${res.statusText}`);
if (!res.ok && res.status !== 202) {
  console.error(await res.text().catch(() => ""));
  process.exit(1);
}
console.log("Submitted.");
