#!/usr/bin/env bun
/**
 * Post-deploy and continuous checks of the five public services.
 *
 * Release mode (the default) requires a dedicated synthetic project's ingest
 * key, query service key, project ID and SMOKE_EXPECTED_RELEASE (a full commit
 * SHA). SMOKE_MODE=local explicitly permits
 * running the public checks without those credentials. Override SMOKE_API_URL,
 * SMOKE_APP_URL, SMOKE_MARKETING_URL, SMOKE_DOCS_URL and SMOKE_MCP_URL for local
 * services. Ingestion writes one synthetic smoke_test event per run.
 *
 * Runtime imports use only repository files: the scheduled job needs Bun but
 * no dependency install. Types and focused tests tie the request to the contract.
 */
import spec from "../openapi.json";
import type { ContractInputs, ContractOutputs } from "../packages/contract/src";

type Environment = Readonly<Record<string, string | undefined>>;
type Result = { name: string; ok: boolean; detail: string; skipped?: boolean };
export type SmokeReport = { mode: "release" | "local"; results: Result[]; ok: boolean };

// Resolve operation paths from the generated contract rather than maintaining
// another route map. The served docs must expose these same POST operations.
function postPath(operationId: string): string {
  const entry = Object.entries(spec.paths).find(([, path]) =>
    "post" in path && path.post.operationId === operationId,
  );
  if (!entry) throw new Error(`Generated OpenAPI is missing POST ${operationId}`);
  return entry[0];
}
const eventsPath = postPath("events.ingest");
const queryPath = postPath("queries.run");
const eventFilter = { op: "eq", field: { source: "dimension", key: "event_type" }, value: "smoke_test" } as const;
const queryBody = (runMarker?: string) => ({
  analysis: {
    shape: "scalar",
    measure: { kind: "count" },
    where: runMarker ? { op: "and", operands: [
      eventFilter,
      { op: "eq", field: { source: "property", key: "smoke_run" }, value: runMarker },
    ] } : eventFilter,
    window: { kind: "relative", amount: 1, unit: "hour" },
    summary: "total",
  },
} satisfies Omit<ContractInputs["queries"]["run"], "projectId">);

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runSmoke(env: Environment = process.env): Promise<SmokeReport> {
  const mode = env.SMOKE_MODE ?? "release";
  expect(mode === "release" || mode === "local", "SMOKE_MODE must be release or local");
  const clientKey = env.SMOKE_CLIENT_KEY?.trim();
  const serviceKey = env.SMOKE_SERVICE_KEY?.trim();
  const projectId = env.SMOKE_PROJECT_ID?.trim();
  const expectedRelease = env.SMOKE_EXPECTED_RELEASE;
  if (mode === "release") {
    const missing = [
      !clientKey && "SMOKE_CLIENT_KEY",
      !serviceKey && "SMOKE_SERVICE_KEY",
      !projectId && "SMOKE_PROJECT_ID",
      !expectedRelease && "SMOKE_EXPECTED_RELEASE",
    ].filter(Boolean);
    expect(missing.length === 0, `Release smoke requires ${missing.join(", ")}`);
  }
  expect(Boolean(serviceKey) === Boolean(projectId), "Set SMOKE_SERVICE_KEY and SMOKE_PROJECT_ID together");
  expect(expectedRelease === undefined || (expectedRelease.length === 40 && /^[0-9a-f]{40}$/.test(expectedRelease)), "SMOKE_EXPECTED_RELEASE must be a full lowercase 40-character commit SHA");

  const base = (name: string, fallback: string) => (env[name] ?? fallback).replace(/\/$/, "");
  const API = base("SMOKE_API_URL", "https://api.counted.dev");
  const APP = base("SMOKE_APP_URL", "https://app.counted.dev");
  const MKT = base("SMOKE_MARKETING_URL", "https://counted.dev");
  const DOCS = base("SMOKE_DOCS_URL", "https://docs.counted.dev");
  const MCP = base("SMOKE_MCP_URL", "https://mcp.counted.dev");
  const results: Result[] = [];
  // Unique per execution, never a persistent user or device identifier.
  const runMarker = clientKey ? crypto.randomUUID() : undefined;
  const request = (url: string, init?: RequestInit) => fetch(url, {
    ...init, redirect: "manual", signal: AbortSignal.timeout(10_000),
  });
  async function check(name: string, fn: () => Promise<string>) {
    try {
      results.push({ name, ok: true, detail: await fn() });
    } catch (err) {
      results.push({ name, ok: false, detail: err instanceof Error ? err.message : "Request failed" });
    }
  }
  function skip(name: string, why: string) {
    results.push({ name, ok: true, skipped: true, detail: `local mode: ${why}` });
  }

  await check("api health 200", async () => {
    const r = await request(`${API}/health`);
    expect(r.status === 200, `expected 200, got ${r.status}`);
    const body = await r.json() as { status?: string } | null;
    expect(body?.status === "ok", "expected status:ok");
    return "200 ok";
  });
  await check("api health/ready 200", async () => {
    const r = await request(`${API}/health/ready`);
    expect(r.status === 200, `expected 200, got ${r.status} — readiness covers the database`);
    const body = await r.json() as { status?: string; release?: string } | null;
    expect(body?.status === "ready", "expected status:ready");
    if (expectedRelease) expect(body.release === expectedRelease, `expected API readiness release ${expectedRelease}`);
    return expectedRelease ? `200 ready ${expectedRelease}` : "200 ready";
  });
  // Do not write the synthetic event to a missing or different release.
  if (expectedRelease && !results.at(-1)?.ok) return { mode, results, ok: false };
  await check("docs openapi.json 200", async () => {
    const r = await request(`${DOCS}/openapi.json`);
    expect(r.status === 200, `expected 200, got ${r.status}`);
    const body = await r.json() as {
      paths?: Record<string, { post?: { operationId?: string } }>;
    } | null;
    for (const [path, operationId] of [[eventsPath, "events.ingest"], [queryPath, "queries.run"]] as const) {
      expect(body?.paths?.[path]?.post?.operationId === operationId, `docs spec is missing POST ${path} (${operationId})`);
    }
    return "200 ingestion + query contract";
  });
  await check("mcp health/ready 200", async () => {
    const r = await request(`${MCP}/health/ready`);
    expect(r.status === 200, `expected 200, got ${r.status}`);
    const body = await r.json() as { ready?: boolean } | null;
    expect(body?.ready === true, "expected ready:true");
    return "200 ready";
  });

  await check("event invalid credential -> 401", async () => {
    const r = await request(`${API}${eventsPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer ck_smoke_invalid" },
      body: JSON.stringify({
        events: [{ name: "smoke_test", visitId: crypto.randomUUID(), occurredAt: new Date().toISOString() }],
      }),
    });
    expect(r.status === 401, `expected 401 (invalid credential), got ${r.status}`);
    return "401";
  });

  const ingestionCheck = "event good-key -> 202 (ingestion)";
  if (clientKey) {
    await check(ingestionCheck, async () => {
      const r = await request(`${API}${eventsPath}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${clientKey}` },
        body: JSON.stringify({
          events: [{
            name: "smoke_test", visitId: crypto.randomUUID(), occurredAt: new Date().toISOString(),
            properties: { source: "smoke", smoke_run: runMarker },
          }],
        }),
      });
      expect(r.status === 202, `expected 202, got ${r.status}`);
      const body = await r.json() as { accepted?: number } | null;
      expect(body?.accepted === 1, "expected accepted:1 after commit");
      return "202 accepted:1";
    });
  } else {
    skip(ingestionCheck, "SMOKE_CLIENT_KEY not configured");
  }

  await check("console root -> sign-in (no SSR crash)", async () => {
    const r = await request(`${APP}/`);
    expect(r.status === 307 || r.status === 302, `expected 307/302 redirect, got ${r.status}`);
    const location = r.headers.get("location");
    expect(location !== null, "console redirect is missing Location");
    const target = new URL(location, `${APP}/`);
    expect(target.origin === new URL(APP).origin && target.pathname === "/sign-in", "expected console redirect to /sign-in on the same origin");
    return `${r.status} /sign-in`;
  });
  await check("marketing /sitemap.xml 200", async () => {
    const r = await request(`${MKT}/sitemap.xml`);
    expect(r.status === 200, `expected 200, got ${r.status}`);
    expect((await r.text()).includes("<urlset"), "sitemap body missing <urlset");
    return "200 xml";
  });
  await check("marketing /robots.txt 200", async () => {
    const r = await request(`${MKT}/robots.txt`);
    expect(r.status === 200, `expected 200, got ${r.status}`);
    expect(/sitemap:/i.test(await r.text()), "robots.txt missing Sitemap line");
    return "200";
  });

  const queryCheck = "authenticated query -> 200 (credentials + query engine)";
  if (serviceKey && projectId) {
    await check(queryCheck, async () => {
      const r = await request(`${API}${queryPath.replace("{projectId}", encodeURIComponent(projectId))}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify(queryBody(runMarker)),
      });
      expect(r.status === 200, `expected 200, got ${r.status}`);
      const body = await r.json() as Partial<ContractOutputs["queries"]["run"]> | null;
      const readout = body?.readout;
      expect(typeof readout?.id === "string" && typeof readout.computedAt === "string" && Number.isFinite(Date.parse(readout.computedAt)), "expected a computed readout");
      expect(readout.value?.shape === "scalar" && typeof readout.value.value === "number" && Number.isFinite(readout.value.value) && readout.value.value >= 0, "expected a finite, nonnegative scalar count");
      if (runMarker) expect(readout.value.value === 1, "expected count:1 for this run's committed event");
      return runMarker ? "200 count:1 for this run" : "200 scalar readout";
    });
  } else {
    skip(queryCheck, "SMOKE_SERVICE_KEY + SMOKE_PROJECT_ID not configured");
  }
  return { mode, results, ok: results.every((result) => result.ok) };
}

if (import.meta.main) {
  try {
    const report = await runSmoke();
    console.log(`\nSmoke (${report.mode} mode)`);
    for (const result of report.results) {
      const tag = result.skipped ? "○ skip" : result.ok ? "✓ pass" : "✗ FAIL";
      console.log(`  ${tag}  ${result.name} — ${result.detail}`);
    }
    const failures = report.results.filter((result) => !result.ok).length;
    console.log(failures ? `\n${failures} check(s) failed.` : `\nAll ${report.results.filter((result) => !result.skipped).length} checks passed.`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (err) {
    console.error(`Smoke configuration: ${err instanceof Error ? err.message : "invalid configuration"}`);
    process.exitCode = 1;
  }
}
