#!/usr/bin/env bun
/**
 * Post-deploy / continuous smoke test.
 *
 * Exercises the real data path that a liveness probe can't — the class of
 * regression that took prod down on 2026-06-01 (a schema column the app
 * SELECTs went missing, invisible to the health check).
 *
 * **This ran against v1's topology until v2 went live.** Every API check
 * pointed at `app.counted.dev/api/v0/*`, which in v2 is the Next.js console
 * and serves none of those paths — so all three returned 404 and the canary
 * reported them as outages. Worse than the noise: a canary aimed at a service
 * that no longer exists cannot detect the outage it was built for. The API is
 * `api.counted.dev` now, and the console is a separate deployable.
 *
 * Most checks need NO secrets: a bad-key event POST returns 401 only if the
 * credential lookup actually runs — a 500 there means schema drift.
 *
 * Env:
 *   SMOKE_API_URL        default https://api.counted.dev   (the API)
 *   SMOKE_APP_URL        default https://app.counted.dev   (the console)
 *   SMOKE_MARKETING_URL  default https://counted.dev
 *   SMOKE_CLIENT_KEY     ck_... ingest credential -> enables the 202 ingest check
 *   SMOKE_SERVICE_KEY + SMOKE_PROJECT_ID -> enables the authenticated query check
 *
 * Exit non-zero if any required check fails.
 */
export {}; // make this a module so top-level await is allowed

const API = (process.env.SMOKE_API_URL ?? "https://api.counted.dev").replace(/\/$/, "");
const APP = (process.env.SMOKE_APP_URL ?? "https://app.counted.dev").replace(/\/$/, "");
const MKT = (process.env.SMOKE_MARKETING_URL ?? "https://counted.dev").replace(/\/$/, "");
const CLIENT_KEY = process.env.SMOKE_CLIENT_KEY;
const SERVICE_KEY = process.env.SMOKE_SERVICE_KEY;
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

/** A visit id is a UUID; the API rejects anything else before it reaches storage. */
const smokeVisitId = () => crypto.randomUUID();

// 1. Liveness.
await check("api health 200", async () => {
  const r = await fetch(`${API}/health`);
  expect(r.status === 200, `expected 200, got ${r.status}`);
  const body = (await r.json().catch(() => ({}))) as { status?: string };
  expect(body.status === "ok", `expected status:ok, got ${JSON.stringify(body)}`);
  return "200 ok";
});

// 2. Readiness — separate from liveness on purpose: this one talks to Postgres,
//    so it is the check that goes red when the database is gone.
await check("api health/ready 200", async () => {
  const r = await fetch(`${API}/health/ready`);
  expect(r.status === 200, `expected 200, got ${r.status} — readiness covers the database`);
  return "200";
});

// 3. The contract is served. Every SDK and generated client derives from it.
await check("openapi.json 200", async () => {
  const r = await fetch(`${API}/v1/openapi.json`);
  expect(r.status === 200, `expected 200, got ${r.status}`);
  const body = (await r.json().catch(() => ({}))) as { paths?: Record<string, unknown> };
  expect(Boolean(body.paths?.["/v1/events"]), "spec served but does not describe /v1/events");
  return "200";
});

// 4. SCHEMA-DRIFT CANARY: a bad credential must 401 (the lookup ran), not 500.
await check("event bad-key -> 401 (credential schema canary)", async () => {
  const r = await fetch(`${API}/v1/events`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer ck_smoke_invalid" },
    body: JSON.stringify({
      events: [{ name: "smoke", visitId: smokeVisitId(), occurredAt: new Date().toISOString() }],
    }),
  });
  expect(
    r.status === 401,
    `expected 401 (bad key), got ${r.status} — 500 here means credential-table schema drift`,
  );
  return "401";
});

// 5. Real ingestion, all the way to commit (needs a synthetic project's ingest key).
if (CLIENT_KEY) {
  await check("event good-key -> 202 (ingestion)", async () => {
    const r = await fetch(`${API}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${CLIENT_KEY}` },
      body: JSON.stringify({
        events: [
          {
            name: "smoke_test",
            visitId: smokeVisitId(),
            occurredAt: new Date().toISOString(),
            properties: { source: "smoke" },
          },
        ],
      }),
    });
    expect(r.status === 202, `expected 202, got ${r.status}`);
    // The ack is post-commit, so a 202 that accepted nothing is still a failure.
    const body = (await r.json().catch(() => ({}))) as { accepted?: number };
    expect(body.accepted === 1, `expected accepted:1, got ${JSON.stringify(body)}`);
    return "202 accepted:1";
  });
} else {
  skip("event good-key -> 202 (ingestion)", "set SMOKE_CLIENT_KEY to enable");
}

// 6. Console-load path: logged-out /dashboards redirects, does not crash (500).
await check("dashboards -> redirect (console loads, no SSR crash)", async () => {
  const r = await fetch(`${APP}/dashboards`, { redirect: "manual" });
  expect(
    r.status === 307 || r.status === 302,
    `expected 307/302 redirect, got ${r.status} — 500 means the console crashed in render`,
  );
  return String(r.status);
});

// 7/8. Marketing SEO files serve on the marketing host (proxy-routing regression class).
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
  expect(/sitemap:/i.test(body), "robots.txt missing Sitemap line");
  return "200";
});

// 9. Authenticated query: exercises credential resolution + the IR compiler + the
//    event store. A service credential, not a console cookie — the public API is
//    the only door, and smoke-testing it through the console's would prove less.
if (SERVICE_KEY && PROJECT_ID) {
  await check("authenticated query -> 200 (credentials + query engine)", async () => {
    const r = await fetch(`${API}/v1/projects/${PROJECT_ID}/query`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        question: {
          kind: "analysis",
          analysis: {
            measure: { kind: "count" },
            window: { kind: "relative", amount: 7, unit: "day" },
          },
        },
      }),
    });
    expect(r.status === 200, `expected 200, got ${r.status}`);
    return "200";
  });
} else {
  skip("authenticated query -> 200", "set SMOKE_SERVICE_KEY + SMOKE_PROJECT_ID to enable");
}

// Report
const failed = results.filter((r) => !r.ok);
console.log(`\nSmoke: api ${API}  console ${APP}  marketing ${MKT}`);
for (const r of results) {
  const tag = r.skipped ? "○ skip" : r.ok ? "✓ pass" : "✗ FAIL";
  console.log(`  ${tag}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
if (failed.length) {
  console.log(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.filter((r) => !r.skipped).length} checks passed.`);
