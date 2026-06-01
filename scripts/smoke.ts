#!/usr/bin/env bun
/**
 * Post-deploy / continuous smoke test.
 *
 * Exercises the real data path that `/api/health` (just `SELECT 1`) can't —
 * the class of regression that took prod down on 2026-06-01 (a schema column
 * the app SELECTs went missing, invisible to the health check).
 *
 * Most checks need NO secrets: a bad-key event POST returns 401 only if the
 * projects lookup (the column that drifted) actually runs — a 500 there means
 * schema drift. Optional checks unlock with env config.
 *
 * Env:
 *   SMOKE_APP_URL        default https://app.counted.dev
 *   SMOKE_MARKETING_URL  default https://www.counted.dev
 *   SMOKE_CLIENT_KEY     ck_... for a synthetic project -> enables the 202 ingest check
 *   SMOKE_SESSION_COOKIE + SMOKE_PROJECT_ID -> enables the authenticated query check
 *
 * Exit non-zero if any required check fails.
 */
export {}; // make this a module so top-level await is allowed

const APP = (process.env.SMOKE_APP_URL ?? "https://app.counted.dev").replace(/\/$/, "");
const MKT = (process.env.SMOKE_MARKETING_URL ?? "https://www.counted.dev").replace(/\/$/, "");
const CLIENT_KEY = process.env.SMOKE_CLIENT_KEY;
const SESSION_COOKIE = process.env.SMOKE_SESSION_COOKIE;
const PROJECT_ID = process.env.SMOKE_PROJECT_ID;

type Result = { name: string; ok: boolean; detail: string; skipped?: boolean };
const results: Result[] = [];

async function check(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (err) {
    results.push({ name, ok: false, detail: String((err as Error).message ?? err) });
  }
}
function skip(name: string, why: string) {
  results.push({ name, ok: true, skipped: true, detail: why });
}
function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// 1. Health
await check("health 200", async () => {
  const r = await fetch(`${APP}/api/health`);
  expect(r.status === 200, `expected 200, got ${r.status}`);
  const body = await r.json().catch(() => ({}));
  expect(body.status === "ok", `expected status:ok, got ${JSON.stringify(body)}`);
  return "200 ok";
});

// 2. API v1 spec served
await check("openapi.json 200", async () => {
  const r = await fetch(`${APP}/api/v0/openapi.json`);
  expect(r.status === 200, `expected 200, got ${r.status}`);
  return "200";
});

// 3. SCHEMA-DRIFT CANARY: bad client key must 401 (projects lookup ran), not 500.
await check("event bad-key -> 401 (projects schema canary)", async () => {
  const r = await fetch(`${APP}/api/v0/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "project-key": "ck_smoke_invalid" },
    body: JSON.stringify({ eventName: "smoke", sessionId: "smoke" }),
  });
  expect(r.status === 401, `expected 401 (bad key), got ${r.status} — 500 here means projects-table schema drift`);
  return "401";
});

// 4. Real ingestion (needs a synthetic project's client key)
if (CLIENT_KEY) {
  await check("event good-key -> 202 (ingestion)", async () => {
    const r = await fetch(`${APP}/api/v0/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "project-key": CLIENT_KEY },
      body: JSON.stringify({ eventName: "smoke_test", sessionId: `smoke-${Date.now()}`, props: { source: "smoke" } }),
    });
    expect(r.status === 202, `expected 202, got ${r.status}`);
    return "202";
  });
} else {
  skip("event good-key -> 202 (ingestion)", "set SMOKE_CLIENT_KEY to enable");
}

// 5. App-load path: logged-out /dashboards redirects to login (307), does not crash (500).
await check("dashboards -> 307 (app loads, no SSR crash)", async () => {
  const r = await fetch(`${APP}/dashboards`, { redirect: "manual" });
  expect(r.status === 307 || r.status === 302, `expected 307/302 redirect, got ${r.status} — 500 means the app crashed in render`);
  return String(r.status);
});

// 6/7. Marketing SEO files serve on the marketing host (proxy-routing regression class).
await check("marketing /sitemap.xml 200", async () => {
  const r = await fetch(`${MKT}/sitemap.xml`);
  expect(r.status === 200, `expected 200, got ${r.status}`);
  const body = await r.text();
  expect(body.includes("<urlset"), "sitemap body missing <urlset");
  return "200 xml";
});
await check("marketing /robots.txt 200", async () => {
  const r = await fetch(`${MKT}/robots.txt`);
  expect(r.status === 200, `expected 200, got ${r.status}`);
  const body = await r.text();
  expect(/sitemap/i.test(body), "robots.txt missing Sitemap line");
  return "200";
});

// 8. Authenticated query: exercises getSession (session-table schema) + the query engine.
if (SESSION_COOKIE && PROJECT_ID) {
  await check("authenticated query -> 200 (session schema + query engine)", async () => {
    const r = await fetch(`${APP}/api/v0/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: SESSION_COOKIE },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        query: { measure: "count", timeBucket: "day" },
        timeRange: { type: "relative", value: 7, unit: "days" },
      }),
    });
    expect(r.status === 200, `expected 200, got ${r.status}`);
    return "200";
  });
} else {
  skip("authenticated query -> 200", "set SMOKE_SESSION_COOKIE + SMOKE_PROJECT_ID to enable");
}

// Report
const failed = results.filter((r) => !r.ok);
console.log(`\nSmoke: ${APP}  (marketing ${MKT})`);
for (const r of results) {
  const tag = r.skipped ? "○ skip" : r.ok ? "✓ pass" : "✗ FAIL";
  console.log(`  ${tag}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
if (failed.length) {
  console.log(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.filter((r) => !r.skipped).length} checks passed.`);
