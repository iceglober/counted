import { API_URL, SITE_URL } from "../../lib/urls";

/**
 * `/index.md` — a markdown representation of the site root.
 *
 * v1 advertised this and v2 never ported it, so the homepage pointed crawlers
 * and agents at a 404 until that link was removed. This restores the route, so
 * the alternate can be advertised again truthfully.
 *
 * It is a summary with links, not a copy of the homepage. A markdown twin that
 * duplicates marketing prose becomes a second description of the product and
 * drifts; what an agent landing here actually needs is what this is, whether
 * it fits the task, and where to go next.
 */
export const dynamic = "force-static";
export const revalidate = 86_400;

const body = `# Counted

Privacy-first product analytics. Custom events, funnels, and composable
dashboards — no cookies, no fingerprinting, no PII, and no consent banner.
Open source (MIT) and self-hostable on plain PostgreSQL.

## What it does

- **Events** — one authenticated POST per batch. Acknowledged only once
  committed, so a \`202\` means durable.
- **Funnels** — genuinely ordered, with an explicit conversion window, and they
  honour property filters.
- **Composable dashboards** — each tile backed by its own query.
- **Agent instrumentation** — the same SDK captures what AI coding agents do:
  tool calls, edits, commands, outcomes. Metadata only, never code or prompts.

## What it deliberately does not do

No cookies, no fingerprinting, no IP storage, no cross-site identifiers. Visits
are grouped by an in-memory id that expires after 30 minutes idle, and a visit
is an activity grouping rather than a person. Person-level analysis requires
you to supply a stable id via \`identify()\`; Counted never derives one. Where
that id is absent, retention is not offered at all rather than shown as a chart
that reads zero.

## Start in one request

    curl -X POST ${API_URL}/v1/provision \\
      -H 'content-type: application/json' -d '{}'

Returns a project and an ingest key. No account required.

## Links

- [Agent index](${SITE_URL}/llms.txt) — start here if you are an agent
- [Authentication](${SITE_URL}/auth.md)
- [Pricing](${SITE_URL}/pricing.md) — free tier is 100,000 events/month
- [OpenAPI](${API_URL}/v1/openapi.json)
- [Documentation](${SITE_URL}/docs) · [API reference](${SITE_URL}/docs/api)
- [For AI agents](${SITE_URL}/for/agents)
- [Source](https://github.com/iceglober/counted)

## SDKs

npm \`@counted/sdk-js\` and \`@counted/sdk-react\` · PyPI \`counted\` ·
crates.io \`counted-sdk\` · Go \`github.com/iceglober/counted/packages/go/v2\`
`;

export function GET(): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
      // Agents may probe this path with `Accept: text/markdown`. Without
      // `Vary: Accept` a CDN can hand the HTML variant to whoever asks second.
      vary: "Accept",
    },
  });
}
