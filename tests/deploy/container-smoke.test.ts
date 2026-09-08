import { describe, expect, test } from "bun:test";
import { anonymousApiHandler, httpProbe } from "./container-smoke";
import { attempt, contractClient } from "../../apps/web/src/lib/client";

type Scenario = {
  unavailable?: boolean;
  missingAsset?: boolean;
  missingIngestion?: boolean;
  wrongIssuer?: boolean;
  acceptsAnonymous?: boolean;
  missingPublicPage?: boolean;
  wrongMarketing?: boolean;
  wrongConsole?: boolean;
  trustsForwardedHost?: boolean;
  wrongDiscoveryType?: boolean;
  internalCatalog?: boolean;
  missingSitemapRoute?: boolean;
  wrongRobots?: boolean;
  wrongDocsRedirect?: boolean;
  docsIgnoreRuntimeLinks?: boolean;
  docsIgnoreRuntimeApi?: boolean;
  docsIgnoreRuntimeDiscovery?: boolean;
};

// Negative controls for the exact probe run inside CI's real containers. These
// local responses prove a broken server cannot produce a successful probe;
// they do not substitute for building or running any image.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<void>;
const probe = new AsyncFunction("service", "fetch", "Bun", "console", httpProbe);
const anonymousResponse = new Function(`return ${anonymousApiHandler}`)() as (request: Request) => Response;
const publicRoutes = ["/", "/pricing", "/about", "/contact", "/privacy", "/terms", "/blog", "/for/agents", "/vs", "/vs/aptabase", "/vs/counter", "/vs/plausible", "/vs/posthog"];

const run = (service: "web" | "docs" | "mcp", scenario: Scenario = {}) => {
  let api: ((request: Request) => Response) | undefined;
  return probe(
    service,
    async (input: string | URL, init?: RequestInit) => {
      const path = new URL(input).pathname;
      const headers = new Headers(init?.headers);
      if (scenario.unavailable) return new Response("Unavailable", { status: 503 });
      if (path === "/health/ready") return Response.json({ ready: true });
      if (path === "/.well-known/oauth-protected-resource/mcp") {
        return Response.json({
          resource: "http://127.0.0.1:8080/mcp",
          authorization_servers: [scenario.wrongIssuer ? "http://other.test/api/auth" : "http://127.0.0.1:1/api/auth"],
        });
      }
      if (path === "/mcp") {
        return new Response("Token required", {
          status: scenario.acceptsAnonymous ? 200 : 401,
          headers: { "WWW-Authenticate": 'Bearer resource_metadata="http://127.0.0.1:8080/.well-known/oauth-protected-resource/mcp"' },
        });
      }
      if (path === "/openapi.json") {
        return Response.json({ paths: scenario.missingIngestion ? {} : { "/v1/events": { post: {} } }, servers: [{ url: scenario.docsIgnoreRuntimeApi ? "https://api.counted.dev" : "https://events.example.test" }] });
      }
      if (path.startsWith("/_next/static/")) {
        return new Response("asset", { status: scenario.missingAsset ? 404 : 200 });
      }
      if (service === "docs" && (path === "/robots.txt" || path === "/sitemap.xml")) {
        const docs = scenario.docsIgnoreRuntimeDiscovery ? "https://docs.counted.dev" : "https://reference.example.test";
        return new Response(path === "/robots.txt" ? `Sitemap: ${docs}/sitemap.xml` : `<loc>${docs}/getting-started</loc>`, { headers: { "content-type": path === "/robots.txt" ? "text/plain" : "application/xml" } });
      }
      if (service === "web") {
        if (scenario.missingPublicPage && path === "/vs/posthog") return new Response("Missing", { status: 404 });
        if (path === "/" && headers.get("Host") === "localhost" && !scenario.wrongConsole &&
            !(scenario.trustsForwardedHost && headers.has("X-Forwarded-Host"))) {
          if (!api || api(new Request("http://127.0.0.1:8189/v1/me")).status !== 401) throw new Error("Anonymous fixture absent");
          return new Response(null, { status: 307, headers: { location: "/sign-in" } });
        }
        const markdown: Record<string, [string, string]> = {
          "/llms.txt": ["text/plain", "# Counted"], "/index.md": ["text/markdown", "# Counted"],
          "/auth.md": ["text/markdown", "# Authenticating"], "/pricing.md": ["text/markdown", "# Counted pricing"],
          "/docs/llms.txt": ["text/plain", "# Counted"], "/docs/api/llms.txt": ["text/plain", "# Counted"],
        };
        const document = markdown[path];
        if (document) return new Response(document[1], { headers: { "content-type": scenario.wrongDiscoveryType ? "text/html" : document[0] } });
        if (path === "/.well-known/api-catalog") {
          return Response.json({ linkset: [{
            anchor: scenario.internalCatalog ? "http://127.0.0.1:8189" : "https://api.counted.dev",
            "service-desc": [{ href: "https://docs.counted.dev/openapi.json" }],
            "service-doc": [{ href: "https://counted.dev/auth.md" }],
          }] }, { headers: { "content-type": "application/linkset+json" } });
        }
        if (path === "/sitemap.xml") {
          const paths = scenario.missingSitemapRoute ? publicRoutes.slice(1) : publicRoutes;
          return new Response(paths.map(route => `<loc>https://counted.dev${route === "/" ? "" : route}</loc>`).join(""), { headers: { "content-type": "application/xml" } });
        }
        if (path === "/robots.txt") {
          const site = headers.get("Host") === "counted.dev";
          return new Response(site || scenario.wrongRobots ? "User-agent: *\nAllow: /\nDisallow: /w/\n" : "User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
        }
        if (path === "/docs" || path.startsWith("/docs/")) {
          return new Response(null, { status: 308, headers: { location: scenario.wrongDocsRedirect ? "/docs" : "https://docs.counted.dev" + (path === "/docs/getting-started" ? "/getting-started" : "") } });
        }
      }
      const docsMarkup = service === "docs" ? `<link rel="canonical" href="https://${scenario.docsIgnoreRuntimeLinks ? "docs.counted.dev" : "reference.example.test"}${path}"><a href="https://console.example.test/api-explorer">Explorer</a><a href="https://console.example.test/claim">Claim</a><code>curl https://events.example.test/v1/events</code>` : "";
      return new Response('<html><head><title>' + (scenario.wrongMarketing ? "Console" : "Counted — privacy-first product analytics") + '</title><link href="/_next/static/main.css"><script src="/_next/static/main.js"></script>' + docsMarkup + '</head></html>');
    },
    { sleep: async () => {}, serve: (options: { fetch: (request: Request) => Response }) => {
      api = options.fetch;
      return { stop: () => { api = undefined; } };
    } },
    { log: () => {} },
  );
};

describe("production container HTTP probe", () => {
  test("accepts complete standalone pages, public discovery, host routing and generated reference", async () => {
    await run("web");
    await run("docs");
  });

  test("refuses missing standalone assets and missing generated ingestion operation", async () => {
    await expect(run("web", { missingAsset: true })).rejects.toThrow("asset missing");
    await expect(run("docs", { missingIngestion: true })).rejects.toThrow("Ingestion missing");
  });

  test("refuses absent marketing routes and incorrect host-based root routing", async () => {
    await expect(run("web", { missingPublicPage: true })).rejects.toThrow("/vs/posthog: HTTP 404");
    await expect(run("web", { wrongMarketing: true })).rejects.toThrow("marketing home");
    await expect(run("web", { wrongConsole: true })).rejects.toThrow("anonymous sign-in redirect");
    await expect(run("web", { trustsForwardedHost: true })).rejects.toThrow("anonymous sign-in redirect");
  });

  test("refuses incorrect discovery formats, private origins, missing sitemap entries, robots exposure and bad redirects", async () => {
    await expect(run("web", { wrongDiscoveryType: true })).rejects.toThrow("incorrect content type");
    await expect(run("web", { internalCatalog: true })).rejects.toThrow("public discovery links");
    await expect(run("web", { missingSitemapRoute: true })).rejects.toThrow("Sitemap");
    await expect(run("web", { wrongRobots: true })).rejects.toThrow("localhost: incorrect robots");
    await expect(run("web", { wrongDocsRedirect: true })).rejects.toThrow("documentation redirect");
  });

  test("anonymous fixture is recognized by the real contract client and cannot perform mutations", async () => {
    const client = contractClient({ authority: {}, origin: "http://fixture.test", fetch: async (url, init) => anonymousResponse(new Request(url, init)) });
    const me = await attempt(client.account.me({}));
    expect(me.ok).toBe(false);
    if (!me.ok) expect(me.failure.code).toBe("UNAUTHORIZED");
    expect(anonymousResponse(new Request("http://fixture.test/v1/me", { method: "POST" })).status).toBe(404);
    expect(anonymousResponse(new Request("http://fixture.test/v1/workspaces")).status).toBe(404);
  });

  test("refuses docs pages, reference and discovery that ignore self-hosted runtime URLs", async () => {
    await expect(run("docs", { docsIgnoreRuntimeLinks: true })).rejects.toThrow("runtime public destinations");
    await expect(run("docs", { docsIgnoreRuntimeApi: true })).rejects.toThrow("runtime public API URL");
    await expect(run("docs", { docsIgnoreRuntimeDiscovery: true })).rejects.toThrow("runtime public URL");
  });

  test("accepts correct MCP metadata and challenge, refuses wrong issuer or anonymous access", async () => {
    await run("mcp");
    await expect(run("mcp", { wrongIssuer: true })).rejects.toThrow("OAuth resource metadata");
    await expect(run("mcp", { acceptsAnonymous: true })).rejects.toThrow("challenge unauthenticated");
  });

  test("readiness exhaustion fails rather than skipping the runtime check", async () => {
    await expect(run("docs", { unavailable: true })).rejects.toThrow("did not become ready");
  });
});
