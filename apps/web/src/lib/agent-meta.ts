// Single source of truth for the agent-facing metadata files (llms.txt, *.md,
// .well-known cards). Keep product facts here so every agent surface agrees.

export const SITE = "https://counted.dev";
export const API = "https://app.counted.dev";
export const API_BASE = `${API}/api/v0`;

export const NAME = "Counted";
export const TAGLINE = "Privacy-first product analytics. No cookies, no PII, agent-native.";

// Response helpers with the right content types.
export function markdown(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
      Vary: "Accept",
    },
  });
}

export function text(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function jsonld(data: unknown, contentType = "application/json"): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// The capabilities agents can act on, reused across agent-card / agent-skills /
// mcp server-card so they never drift.
export const SKILLS = [
  {
    id: "provision-project",
    name: "Provision a project key",
    description:
      "Mint a write-only client key (ck_) and a claim link with no signup: POST /api/v0/provision. The key can ingest events but cannot read data.",
  },
  {
    id: "track-event",
    name: "Track an event",
    description:
      "Send a product-analytics event: POST /api/v0/event with a client key. One event or a batch of up to 50. Privacy-first: no cookies, no PII.",
  },
  {
    id: "query-metrics",
    name: "Query metrics",
    description:
      "Read counts, breakdowns, time series, and funnels over your events with a server key (sk_) as a Bearer token: POST /api/v0/query.",
  },
  {
    id: "migrate-from-aptabase",
    name: "Migrate from Aptabase",
    description:
      "Import event history from a self-hosted Aptabase (ClickHouse) with the @counted/migrate CLI, then read it on a live dashboard immediately.",
  },
];
