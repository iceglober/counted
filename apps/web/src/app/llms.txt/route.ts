import { API_URL, SITE_URL } from "../../lib/urls";

/**
 * `/llms.txt` — the navigation index for agents.
 *
 * There was already a `/docs/llms.txt`, but nothing at the root, which is the
 * path anything arriving cold actually probes. This is deliberately an index,
 * not a manual: headings, links, and a short "when to use" section. Long-form
 * content stays in the docs and is linked, so this file does not become a
 * second description of the product that drifts from the first.
 *
 * The "when to use" framing is the part that earns its place. An agent
 * choosing between analytics products needs to know what Counted is *for* and
 * where it is the wrong answer — marketing copy does not read as guidance, and
 * an agent that picks the wrong tool wastes a user's time.
 */
export const dynamic = "force-static";
export const revalidate = 86_400;

const body = `# Counted

Privacy-first product analytics. Custom events, funnels, and composable
dashboards, with no cookies, no fingerprinting, and no PII. Open source and
self-hostable.

## When to use Counted

Reach for Counted when a task needs any of:

- Recording product events from an app, service, or script — one authenticated
  POST per batch, no client library required.
- Answering "how many", "what changed", or "where did people drop off" over
  event data, including funnels with an explicit conversion window.
- Instrumenting an AI coding agent's tool calls, edits, and outcomes.
- Analytics in a context where cookies or consent banners are unacceptable, or
  where the data must stay on infrastructure you control.

Counted is **not** the right answer for: session replay, error monitoring,
server logs, A/B test assignment, or person-level retention when you cannot
supply your own stable user id (see Identity below).

## How an agent calls it

1. \`POST ${API_URL}/v1/provision\` — needs no credential. Returns a project and
   an ingest key (\`ck_…\`).
2. \`POST ${API_URL}/v1/events\` with \`Authorization: Bearer <ck_…>\` — send
   events. Returns 202 only after the batch is committed.
3. \`POST ${API_URL}/v1/projects/{projectId}/query\` — run an analysis. Needs a
   credential carrying the \`queries:run\` scope; an ingest key does not have it
   and will get a 403 saying so.

Full contract: [OpenAPI](${API_URL}/v1/openapi.json) ·
[auth walkthrough](${SITE_URL}/auth.md) ·
[protected-resource metadata](${API_URL}/.well-known/oauth-protected-resource)

## Identity

Counted never derives, infers, or invents an identity. Events are grouped by an
in-memory visit id that expires after 30 minutes idle — a visit is an activity
grouping, not a person. Person-level analysis requires calling \`identify()\`
with your own stable id. Retention is not offered at all without one, rather
than shown as a chart that reads zero.

## Docs

- [Documentation](${SITE_URL}/docs)
- [API reference](${SITE_URL}/docs/api)
- [Docs index for agents](${SITE_URL}/docs/llms.txt)
- [Pricing, machine-readable](${SITE_URL}/pricing.md)
- [Authentication](${SITE_URL}/auth.md)
- [For AI agents](${SITE_URL}/for/agents)

## SDKs

JavaScript/TypeScript and React (under 3KB gzipped, zero-dependency), Python,
Go, and Rust. All are driven against one golden-trace conformance suite, so
retry, backoff, and batching behave identically across languages.

- npm: \`@counted/sdk-js\`, \`@counted/sdk-react\`
- PyPI: \`counted\`
- crates.io: \`counted-sdk\`
- Go: \`github.com/iceglober/counted/packages/go/v2\`

## Comparisons

- [vs Aptabase](${SITE_URL}/vs/aptabase)
- [vs PostHog](${SITE_URL}/vs/posthog)
- [vs Plausible](${SITE_URL}/vs/plausible)
- [vs counter.dev](${SITE_URL}/vs/counter)

## Self-hosting

Docker Compose, plain PostgreSQL. No TimescaleDB and no other extension is
required. MIT licensed: <https://github.com/iceglober/counted>
`;

export function GET(): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
