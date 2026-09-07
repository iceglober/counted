/**
 * Exercise the actual production image from CI, using its default command.
 * This script deliberately requires Docker; missing infrastructure is a failure.
 * API/worker stop at configuration validation, while the HTTP services run with
 * loopback-only test URLs in containers with no network or published ports.
 */
import { readFileSync } from "node:fs";

const services = ["api", "worker", "mcp", "web", "docs"] as const;
type Service = (typeof services)[number];

// A read-only anonymous API fixture for the console's signed-out redirect.
// It lives on loopback inside the web container; no account is created and no
// credential is supplied. The contract-client test verifies this wire error.
export const anonymousApiHandler = String.raw`function(request) {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/v1/me") {
    return Response.json({ defined: false, inferable: false, code: "UNAUTHORIZED", message: "Sign in required" }, { status: 401 });
  }
  if (request.method === "GET" && path === "/api/auth/capabilities") {
    return Response.json({ email: false, social: [] });
  }
  return new Response("No fixture for this request", { status: 404 });
}`;

// Executed by Bun inside the running image. Kept dependency-free so it checks
// the shipped server and assets without adding a test runtime to that image.
export const httpProbe = String.raw`
const origin = "http://127.0.0.1:8080";
let accountLookups = 0;
const anonymousResponse = ${anonymousApiHandler};
const anonymousApi = service === "web" ? Bun.serve({
  hostname: "127.0.0.1", port: 8189,
  fetch(request) {
    if (new URL(request.url).pathname === "/v1/me") accountLookups++;
    return anonymousResponse(request);
  },
}) : null;
try {
const readyPath = service === "mcp" ? "/health/ready" : service === "docs" ? "/openapi.json" : "/sign-in";
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch(origin + readyPath, { signal: AbortSignal.timeout(1000) });
    if (response.status === 200) { ready = true; break; }
  } catch {}
  await Bun.sleep(250);
}
if (!ready) throw new Error("Production server did not become ready");
if (service === "mcp") {
  const response = await fetch(origin + "/health/ready");
  if ((await response.json()).ready !== true) throw new Error("MCP readiness is false");
  const metadata = await fetch(origin + "/.well-known/oauth-protected-resource/mcp");
  const document = await metadata.json();
  if (metadata.status !== 200 || document.resource !== origin + "/mcp" ||
      document.authorization_servers?.length !== 1 ||
      document.authorization_servers[0] !== "http://127.0.0.1:1/api/auth") {
    throw new Error("Incorrect MCP OAuth resource metadata");
  }
  const challenge = await fetch(origin + "/mcp", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  if (challenge.status !== 401 || !challenge.headers.get("WWW-Authenticate")?.includes("resource_metadata")) {
    throw new Error("MCP must challenge unauthenticated requests");
  }
  console.log("MCP: readiness, OAuth metadata, and authentication challenge passed");
} else {
  const publicRoutes = ["/", "/pricing", "/about", "/contact", "/privacy", "/terms", "/blog", "/for/agents", "/vs", "/vs/aptabase", "/vs/counter", "/vs/plausible", "/vs/posthog"];
  const routes = service === "docs"
    ? ["/", "/getting-started", "/openapi.json"]
    : [...publicRoutes, "/sign-in", "/design", "/design/aggregates", "/design/primitives/chart"];
  const assets = new Map();
  const siteRequest = (route, host = "counted.dev", extraHeaders = {}) => fetch(origin + route, {
    headers: { Host: host, ...extraHeaders }, redirect: "manual", signal: AbortSignal.timeout(10000),
  });
  for (const route of routes) {
    const response = service === "web" ? await siteRequest(route) : await fetch(origin + route, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    const body = await response.text();
    if (response.status !== 200) throw new Error(route + ": HTTP " + response.status);
    if (route === "/openapi.json") {
      const document = JSON.parse(body);
      if (!document.paths?.["/v1/events"]?.post) throw new Error("Ingestion missing from OpenAPI");
      if (document.servers?.[0]?.url !== "https://events.example.test") throw new Error("OpenAPI ignored the runtime public API URL");
    } else {
      if (!body.includes("<html")) throw new Error(route + ": missing HTML document");
      if (service === "web" && route === "/" && !body.includes("privacy-first product analytics</title>")) {
        throw new Error("Public host did not render the marketing home");
      }
      if (service === "docs") {
        const canonical = body.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
        if (!canonical || new URL(canonical).href !== new URL(route, "https://reference.example.test").href ||
            !body.includes('href="https://console.example.test/api-explorer"') ||
            (route === "/getting-started" && (!body.includes('href="https://console.example.test/claim"') ||
              !body.includes("curl https://events.example.test/v1/events")))) {
          throw new Error(route + ": documentation ignored its runtime public destinations");
        }
      }
      for (const match of body.matchAll(/(?:href|src)="([^\"]*\/_next\/static\/[^\"]+\.(css|js)(?:\?[^\"]*)?)"/g)) {
        if (!assets.has(match[2])) assets.set(match[2], match[1].replaceAll("&amp;", "&"));
      }
    }
    console.log(route + ": HTTP " + response.status);
  }
  if (service === "web") {
    const discovery = [
      ["/llms.txt", "text/plain", "# Counted"],
      ["/index.md", "text/markdown", "# Counted"],
      ["/auth.md", "text/markdown", "# Authenticating"],
      ["/pricing.md", "text/markdown", "# Counted pricing"],
      ["/docs/llms.txt", "text/plain", "# Counted"],
      ["/docs/api/llms.txt", "text/plain", "# Counted"],
    ];
    for (const [route, contentType, marker] of discovery) {
      const response = await siteRequest(route);
      if (response.status !== 200 || !response.headers.get("content-type")?.startsWith(contentType) || !(await response.text()).includes(marker)) {
        throw new Error(route + ": missing discovery document or incorrect content type");
      }
    }
    const catalog = await siteRequest("/.well-known/api-catalog");
    const catalogBody = await catalog.json();
    const linkset = catalogBody.linkset?.[0];
    if (catalog.status !== 200 || !catalog.headers.get("content-type")?.startsWith("application/linkset+json") ||
        linkset?.anchor !== "https://api.counted.dev" ||
        !linkset["service-desc"]?.some(link => link.href === "https://docs.counted.dev/openapi.json") ||
        !linkset["service-doc"]?.some(link => link.href === "https://counted.dev/auth.md")) {
      throw new Error("API catalog has incorrect public discovery links");
    }
    const sitemap = await siteRequest("/sitemap.xml");
    const sitemapBody = await sitemap.text();
    if (sitemap.status !== 200 || !sitemap.headers.get("content-type")?.includes("xml") ||
        publicRoutes.some(route => !sitemapBody.includes("<loc>https://counted.dev" + (route === "/" ? "" : route) + "</loc>"))) {
      throw new Error("Sitemap is missing a public route");
    }
    for (const host of ["counted.dev", "localhost"]) {
      const response = await siteRequest("/robots.txt", host);
      const body = await response.text();
      const correctRules = host === "counted.dev"
        ? /^Allow: \/$/m.test(body) && /^Disallow: \/w\/$/m.test(body) && !/^Disallow: \/$/m.test(body)
        : /^Disallow: \/$/m.test(body) && !/^Allow:/m.test(body);
      if (response.status !== 200 || !response.headers.get("content-type")?.startsWith("text/plain") || !correctRules) {
        throw new Error(host + ": incorrect robots rules");
      }
    }
    for (const [route, destination] of [["/docs", "https://docs.counted.dev"], ["/docs/api", "https://docs.counted.dev"], ["/docs/any-legacy", "https://docs.counted.dev"], ["/docs/getting-started", "https://docs.counted.dev/getting-started"]]) {
      const response = await siteRequest(route);
      if (response.status !== 308 || new URL(response.headers.get("location"), origin).href !== new URL(destination).href) {
        throw new Error(route + ": incorrect documentation redirect");
      }
    }
    if (accountLookups !== 0) throw new Error("Public site unexpectedly queried the calling account");
    for (const headers of [{}, { "X-Forwarded-Host": "counted.dev" }]) {
      const response = await siteRequest("/", "localhost", headers);
      if (response.status !== 307 || new URL(response.headers.get("location"), origin).pathname !== "/sign-in") {
        throw new Error("Console host did not preserve the anonymous sign-in redirect");
      }
    }
    if (accountLookups !== 2) throw new Error("Console root did not query the anonymous calling account");
    console.log("Public pages, discovery, docs redirects, and separate console host passed");
  } else {
    for (const [route, contentType, marker] of [
      ["/robots.txt", "text/plain", "Sitemap: https://reference.example.test/sitemap.xml"],
      ["/sitemap.xml", "application/xml", "<loc>https://reference.example.test/getting-started</loc>"],
    ]) {
      const response = await fetch(origin + route, { redirect: "manual", signal: AbortSignal.timeout(10000) });
      if (response.status !== 200 || !response.headers.get("content-type")?.startsWith(contentType) || !(await response.text()).includes(marker)) {
        throw new Error(route + ": docs discovery ignored its runtime public URL");
      }
    }
    console.log("Docs links, canonical URLs, discovery, and OpenAPI use runtime public destinations");
  }
  if (!assets.has("css") || !assets.has("js")) throw new Error("Missing linked stylesheet or JavaScript");
  for (const [kind, asset] of assets) {
    const url = new URL(asset, origin);
    if (url.origin !== origin) throw new Error("Static asset is not served by this image");
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (response.status !== 200 || (await response.arrayBuffer()).byteLength === 0) {
      throw new Error(kind + " asset missing from standalone image");
    }
    console.log(kind + " static asset: HTTP " + response.status);
  }
}
} finally { anonymousApi?.stop(true); }
`;

async function docker(args: string[], timeoutMs = 30_000) {
  const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (timedOut) throw new Error(`docker ${args[0]} exceeded ${timeoutMs}ms`);
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}

async function checked(args: string[], timeoutMs?: number) {
  const result = await docker(args, timeoutMs);
  if (result.code !== 0) throw new Error(`docker ${args[0]} failed (${result.code}):\n${result.stdout}${result.stderr}`);
  return result.stdout.trim();
}

async function verify(service: Service) {
  const image = `counted-ci:${service}`;
  const name = `counted-ci-${service}-${process.pid}`;
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { packageManager: string };
  const expectedBun = manifest.packageManager.replace(/^bun@/, "");
  const version = await checked(["run", "--rm", "--network", "none", "--entrypoint", "bun", image, "--version"]);
  if (version !== expectedBun) throw new Error(`Image Bun ${version} differs from ${manifest.packageManager}`);
  try {
    if (service === "api" || service === "worker") {
      const result = await docker(["run", "--name", name, "--network", "none", image]);
      const output = result.stdout + result.stderr;
      const expected = service === "api"
        ? /config: DATABASE_URL is required and was empty/
        : /the worker cannot start:[\s\S]*DATABASE_URL: required/;
      if (result.code !== 1 || !expected.test(output)) {
        throw new Error(`Expected configuration refusal from the real ${service} entry point; got ${result.code}:\n${output}`);
      }
      if (service === "api") {
        await checked(["run", "--rm", "--network", "none", "--entrypoint", "bun", image, "-e",
          'const file = Bun.file("/app/packages/ingestion/adapter-geoip/data/ip-country.bin"); if (!(await file.exists()) || file.size === 0) throw new Error("Required geo table missing from API image");']);
      }
      console.log(`${service}: default entry point resolves and refuses missing database configuration`);
      return;
    }
    const env = ["--env", "PORT=8080", "--env", `COUNTED_API_URL=http://127.0.0.1:${service === "web" ? "8189" : "1"}`];
    if (service === "mcp") {
      env.push("--env", "COUNTED_MCP_RESOURCE=http://127.0.0.1:8080/mcp", "--env", "COUNTED_OAUTH_ISSUER=http://127.0.0.1:1/api/auth");
    } else if (service === "docs") {
      // Set only when starting the already-built image, proving self-hosted
      // public links do not depend on build-time or internal API addresses.
      env.push("--env", "COUNTED_DOCS_URL=https://reference.example.test", "--env", "COUNTED_CONSOLE_URL=https://console.example.test", "--env", "COUNTED_PUBLIC_API_URL=https://events.example.test");
    }
    await checked(["run", "--detach", "--name", name, "--network", "none", ...env, image]);
    console.log(await checked(["exec", name, "bun", "-e", `const service = ${JSON.stringify(service)};\n${httpProbe}`], 120_000));
    await checked(["stop", "--time", "10", name]);
    const exit = await checked(["inspect", "--format", "{{.State.ExitCode}}", name]);
    // Next 16 explicitly exits 143 after its SIGTERM cleanup; MCP exits 0.
    if (exit !== (service === "mcp" ? "0" : "143")) throw new Error(`${service} did not shut down cleanly: ${exit}`);
  } catch (error) {
    const logs = await docker(["logs", name]);
    if (logs.code === 0) console.error(logs.stdout + logs.stderr);
    throw error;
  } finally {
    const removed = await docker(["rm", "--force", name]);
    if (removed.code !== 0 && !removed.stderr.includes("No such container")) {
      throw new Error(`Could not clean up ${name}: ${removed.stderr}`);
    }
  }
}

if (import.meta.main) {
  const service = process.argv[2];
  if (!services.includes(service as Service)) throw new Error("Usage: bun tests/deploy/container-smoke.ts <api|worker|mcp|web|docs>");
  await verify(service as Service);
}
