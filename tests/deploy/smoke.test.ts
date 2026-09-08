import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSmoke } from "../../scripts/smoke";
import spec from "../../openapi.json";
import { AnalysisSchema } from "../../packages/contract/src/schemas/analysis";
import { IngestRequestSchema } from "../../packages/contract/src/schemas/ingestion";
import { toPredicate } from "../../apps/api/src/analysis/wire";
import { matches, type RawEvent } from "../../packages/analytics/adapter-litics/src/raw";

type Handler = (request: Request) => Response | Promise<Response>;
type Overrides = Record<string, Handler>;
const queryPath = "/v1/projects/smoke-project/queries";
const release = "a".repeat(40);
const queryReply = { readout: { id: "smoke-readout", computedAt: new Date().toISOString(), value: { shape: "scalar", value: 1 } } };

async function fixture<T>(overrides: Overrides, run: (env: Record<string, string>, requests: string[], queries: unknown[]) => Promise<T>, storage: "normal" | "discard" | "wrong-run" = "normal"): Promise<T> {
  const requests: string[] = [];
  const queries: unknown[] = [];
  const events: RawEvent[] = [
    { ts: Date.now(), actor: "earlier-run", dimensions: { event_type: "smoke_test" }, properties: { smoke_run: "earlier-run" } },
  ];
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (overrides[path]) return overrides[path](request);
      if (request.method === "GET") {
        if (path === "/health") return Response.json({ status: "ok" });
        if (path === "/health/ready") return Response.json({ status: "ready", release });
        if (path === "/mcp/health/ready") return Response.json({ ready: true });
        if (path === "/docs/openapi.json") return Response.json(spec);
        if (path === "/") return new Response(null, { status: 307, headers: { location: "/sign-in" } });
        if (path === "/marketing/sitemap.xml") return new Response("<?xml version=\"1.0\"?><urlset></urlset>");
        if (path === "/marketing/robots.txt") return new Response("Sitemap: https://example.test/sitemap.xml");
      }
      if (request.method === "POST" && path === "/v1/events") {
        const input = IngestRequestSchema.safeParse(await request.json());
        if (!input.success) return Response.json({ error: "Invalid current ingestion request" }, { status: 400 });
        if (request.headers.get("authorization") !== "Bearer ck_smoke_fixture") return new Response(null, { status: 401 });
        if (storage !== "discard") {
          events.push(...input.data.events.map((event): RawEvent => ({
            ts: Date.now(), actor: event.visitId, dimensions: { event_type: event.name },
            properties: { ...event.properties, ...(storage === "wrong-run" ? { smoke_run: "another-run" } : {}) },
          })));
        }
        return Response.json({ accepted: input.data.events.length, deduplicated: 0, rejected: 0 }, { status: 202 });
      }
      if (request.method === "POST" && path === queryPath) {
        if (request.headers.get("authorization") !== "Bearer sk_smoke_fixture") return new Response(null, { status: 401 });
        const input = await request.json() as Record<string, unknown>;
        queries.push(input);
        // Validate the real transmitted body with the current contract, not an
        // echo of smoke's own constants. Old question wrappers and analyses fail.
        const analysis = AnalysisSchema.safeParse(input.analysis);
        if (Object.keys(input).join(",") !== "analysis" || !analysis.success || analysis.data.shape !== "scalar") {
          return Response.json({ error: "Invalid current query request" }, { status: 400 });
        }
        const predicate = analysis.data.where && toPredicate(analysis.data.where);
        if (!predicate || !predicate.ok) return new Response(null, { status: 422 });
        const count = events.filter((event) => matches(event, predicate.value)).length;
        return Response.json({ readout: { ...queryReply.readout, value: { shape: "scalar", value: count } } });
      }
      return new Response("No such route", { status: 404 });
    },
  });
  const origin = server.url.origin;
  try {
    return await run({
      SMOKE_MODE: "release", SMOKE_API_URL: origin, SMOKE_APP_URL: origin,
      SMOKE_EXPECTED_RELEASE: release,
      SMOKE_MARKETING_URL: `${origin}/marketing`, SMOKE_DOCS_URL: `${origin}/docs`, SMOKE_MCP_URL: `${origin}/mcp`,
      SMOKE_CLIENT_KEY: "ck_smoke_fixture", SMOKE_SERVICE_KEY: "sk_smoke_fixture", SMOKE_PROJECT_ID: "smoke-project",
    }, requests, queries);
  } finally {
    await server.stop(true);
  }
}

describe("release smoke over HTTP", () => {
  test("current routes, generated docs operations and schema-valid request all pass without skips", async () => {
    await fixture({}, async (env, requests, queries) => {
      const result = await runSmoke(env);
      expect(result.ok).toBe(true);
      expect(result.mode).toBe("release");
      expect(result.results).toHaveLength(10);
      expect(result.results.some((r) => r.skipped)).toBe(false);
      expect(requests).toContain("GET /");
      expect(requests).toContain("GET /docs/openapi.json");
      expect(requests).toContain(`POST ${queryPath}`);
      expect(requests).not.toContain("GET /dashboards");
      expect(requests).not.toContain("GET /v1/openapi.json");
      expect(requests).not.toContain("POST /v1/projects/smoke-project/query");
      expect(queries).toHaveLength(1);
      const analysis = AnalysisSchema.parse((queries[0] as { analysis: unknown }).analysis);
      expect(analysis.shape).toBe("scalar");
      if (analysis.shape !== "scalar") throw new Error("Expected scalar analysis");
      expect(analysis.where).toEqual({ op: "and", operands: [
        { op: "eq", field: { source: "dimension", key: "event_type" }, value: "smoke_test" },
        { op: "eq", field: { source: "property", key: "smoke_run" }, value: expect.any(String) },
      ] });
      const next = await runSmoke(env);
      expect(next.ok).toBe(true);
      expect(queries[1]).not.toEqual(queries[0]);
    });
  });

  test.each(["SMOKE_CLIENT_KEY", "SMOKE_SERVICE_KEY", "SMOKE_PROJECT_ID", "SMOKE_EXPECTED_RELEASE"])("missing %s fails release configuration before any HTTP call", async (missing) => {
    await fixture({}, async (env, requests) => {
      await expect(runSmoke({ ...env, [missing]: "  " })).rejects.toThrow(missing);
      expect(requests).toEqual([]);
    });
  });

  test.each(["main", "abc123", "A".repeat(40), "a".repeat(39), "a".repeat(41), "a".repeat(40) + "\n"])("invalid expected release %j refuses before any HTTP call", async (sha) => {
    await fixture({}, async (env, requests) => {
      await expect(runSmoke({ ...env, SMOKE_EXPECTED_RELEASE: sha })).rejects.toThrow("full lowercase 40-character commit SHA");
      expect(requests).toEqual([]);
    });
  });

  test.each([undefined, "b".repeat(40), "main"])("missing or stale API release %j fails before synthetic writes", async (sha) => {
    await fixture({ "/health/ready": () => Response.json({ status: "ready", release: sha }) }, async (env, requests) => {
      const result = await runSmoke(env);
      expect(result.ok).toBe(false);
      expect(result.results.at(-1)?.detail).toContain(`expected API readiness release ${release}`);
      expect(requests).toEqual(["GET /health", "GET /health/ready"]);
    });
  });

  test("release is the default and unsupported modes cannot enable skips", async () => {
    await fixture({}, async (env, requests) => {
      await expect(runSmoke({ ...env, SMOKE_MODE: undefined, SMOKE_CLIENT_KEY: undefined })).rejects.toThrow("Release smoke requires SMOKE_CLIENT_KEY");
      await expect(runSmoke({ ...env, SMOKE_MODE: "optional" })).rejects.toThrow("SMOKE_MODE must be release or local");
      expect(requests).toEqual([]);
    });
  });

  test("explicit local mode reports both credential checks skipped", async () => {
    await fixture({}, async (env, requests) => {
      const result = await runSmoke({ ...env, SMOKE_MODE: "local", SMOKE_CLIENT_KEY: "", SMOKE_SERVICE_KEY: "", SMOKE_PROJECT_ID: "", SMOKE_EXPECTED_RELEASE: undefined });
      expect(result.ok).toBe(true);
      expect(result.results.filter((r) => r.skipped)).toHaveLength(2);
      expect(requests.filter((r) => r.startsWith("POST"))).toEqual(["POST /v1/events"]);
    });
  });

  test.each(["SMOKE_SERVICE_KEY", "SMOKE_PROJECT_ID"])("partial local credentials still refuse missing %s", async (missing) => {
    await fixture({}, async (env, requests) => {
      await expect(runSmoke({ ...env, SMOKE_MODE: "local", [missing]: "" })).rejects.toThrow("together");
      expect(requests).toEqual([]);
    });
  });

  test("local query-only mode accepts zero events without claiming a roundtrip", async () => {
    await fixture({ [queryPath]: () => Response.json({ readout: { ...queryReply.readout, value: { shape: "scalar", value: 0 } } }) }, async (env) => {
      const result = await runSmoke({ ...env, SMOKE_MODE: "local", SMOKE_CLIENT_KEY: "" });
      expect(result.ok).toBe(true);
      expect(result.results.filter((r) => r.skipped)).toHaveLength(1);
      expect(result.results.at(-1)?.detail).toBe("200 scalar readout");
    });
  });

  test.each(["discard", "wrong-run"] as const)("an acknowledged but %s event fails the ingest-to-query roundtrip", async (storage) => {
    await fixture({}, async (env) => {
      const result = await runSmoke(env);
      expect(result.ok).toBe(false);
      expect(result.results.find((r) => r.name.startsWith("event good-key"))?.ok).toBe(true);
      expect(result.results.at(-1)).toMatchObject({ ok: false, detail: "expected count:1 for this run's committed event" });
    }, storage);
  });

  const negatives: { name: string; path: string; response: Handler; failedCheck: string }[] = [
    { name: "API reports not ready with 200", path: "/health/ready", response: () => Response.json({ status: "not_ready" }), failedCheck: "api health/ready" },
    { name: "MCP reports not ready with 200", path: "/mcp/health/ready", response: () => Response.json({ ready: false }), failedCheck: "mcp health/ready" },
    { name: "docs are unavailable", path: "/docs/openapi.json", response: () => new Response(null, { status: 404 }), failedCheck: "docs openapi" },
    { name: "docs omit ingestion", path: "/docs/openapi.json", response: () => Response.json({ paths: { "/v1/projects/{projectId}/queries": spec.paths["/v1/projects/{projectId}/queries"] } }), failedCheck: "docs openapi" },
    { name: "docs omit current query", path: "/docs/openapi.json", response: () => Response.json({ paths: { "/v1/events": spec.paths["/v1/events"] } }), failedCheck: "docs openapi" },
    { name: "bad credential is accepted", path: "/v1/events", response: () => Response.json({ accepted: 1 }, { status: 202 }), failedCheck: "event invalid credential" },
    { name: "credential refusal crashes", path: "/v1/events", response: () => new Response(null, { status: 500 }), failedCheck: "event invalid credential" },
    { name: "ingestion acknowledges no event", path: "/v1/events", response: (r) => r.headers.get("authorization") === "Bearer ck_smoke_invalid" ? new Response(null, { status: 401 }) : Response.json({ accepted: 0 }, { status: 202 }), failedCheck: "event good-key" },
    { name: "console root is missing", path: "/", response: () => new Response(null, { status: 404 }), failedCheck: "console root" },
    { name: "console redirects to an error page", path: "/", response: () => new Response(null, { status: 307, headers: { location: "/error" } }), failedCheck: "console root" },
    { name: "console redirects to another host", path: "/", response: () => new Response(null, { status: 307, headers: { location: "https://other.example.test/sign-in" } }), failedCheck: "console root" },
    { name: "query endpoint rejects the request", path: queryPath, response: () => new Response(null, { status: 400 }), failedCheck: "authenticated query" },
    { name: "query key lacks permission", path: queryPath, response: () => new Response(null, { status: 403 }), failedCheck: "authenticated query" },
    { name: "query redirects instead of answering", path: queryPath, response: () => new Response(null, { status: 302, headers: { location: "/" } }), failedCheck: "authenticated query" },
    { name: "query returns an error disguised as 200", path: queryPath, response: () => Response.json({ error: "unavailable" }), failedCheck: "authenticated query" },
    { name: "query returns a different shape", path: queryPath, response: () => Response.json({ readout: { ...queryReply.readout, value: { shape: "series", points: [] } } }), failedCheck: "authenticated query" },
    { name: "query count is not numeric", path: queryPath, response: () => Response.json({ readout: { ...queryReply.readout, value: { shape: "scalar", value: "1" } } }), failedCheck: "authenticated query" },
    { name: "query count is negative", path: queryPath, response: () => Response.json({ readout: { ...queryReply.readout, value: { shape: "scalar", value: -1 } } }), failedCheck: "authenticated query" },
    { name: "query count is zero", path: queryPath, response: () => Response.json({ readout: { ...queryReply.readout, value: { shape: "scalar", value: 0 } } }), failedCheck: "authenticated query" },
    { name: "query counts unrelated or duplicated events", path: queryPath, response: () => Response.json({ readout: { ...queryReply.readout, value: { shape: "scalar", value: 2 } } }), failedCheck: "authenticated query" },
    { name: "query lacks its computed timestamp", path: queryPath, response: () => Response.json({ readout: { ...queryReply.readout, computedAt: null } }), failedCheck: "authenticated query" },
  ];
  test.each(negatives)("refuses $name", async ({ path, response, failedCheck }) => {
    await fixture({ [path]: response }, async (env) => {
      const result = await runSmoke(env);
      expect(result.ok).toBe(false);
      expect(result.results.some((r) => !r.ok && r.name.startsWith(failedCheck))).toBe(true);
    });
  });

  test("CLI needs no installed dependencies, and signals success, request failure and configuration failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "counted-smoke-cli-"));
    try {
      await mkdir(join(directory, "scripts"));
      const script = join(directory, "scripts/smoke.ts");
      await copyFile(new URL("../../scripts/smoke.ts", import.meta.url), script);
      await copyFile(new URL("../../openapi.json", import.meta.url), join(directory, "openapi.json"));
      const cli = async (env: Record<string, string>) => {
        const child = Bun.spawn([process.execPath, script], { cwd: directory, env, stdout: "pipe", stderr: "pipe" });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        return { code, stdout, stderr };
      };
      await fixture({}, async (env) => {
        const passed = await cli(env);
        expect(passed.code).toBe(0);
        expect(passed.stdout).toContain("All 10 checks passed");
        expect(passed.stdout).not.toContain("skip");
      });
      await fixture({ [queryPath]: () => new Response(null, { status: 503 }) }, async (env) => {
        const failed = await cli(env);
        expect(failed.code).toBe(1);
        expect(failed.stdout).toContain("FAIL  authenticated query");
      });
      await fixture({}, async (env, requests) => {
        const refused = await cli({ ...env, SMOKE_CLIENT_KEY: "" });
        expect(refused.code).toBe(1);
        expect(refused.stderr).toContain("Release smoke requires SMOKE_CLIENT_KEY");
        expect(requests).toEqual([]);
        expect(refused.stderr).not.toContain("sk_smoke_fixture");
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
