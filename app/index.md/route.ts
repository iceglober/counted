import { markdown } from "@/lib/agent-meta";

// Markdown twin of the homepage (/index.md) — the canonical markdown URL for the
// site root, plus the cold-arrival path for agents that land here from search.
const CONTENT = `# Counted — privacy-first product analytics

Product analytics with custom events, funnels, and composable dashboards — and
**no cookies, no fingerprinting, no PII**. Under 3KB gzipped. The same SDK
instruments your product and your AI coding agents.

## What it is
- Privacy-first: sessions are ephemeral (in-memory, ~30 min), never a cookie or
  a stored identity. GDPR/CCPA-friendly with no consent banner.
- Product analytics, not just pageviews: custom events, funnels, breakdowns,
  time series, and dashboards you compose yourself.
- Agent-native: native plugins turn an AI coding agent's tool calls, file edits,
  and outcomes into a pre-built eval dashboard.
- Open source and self-hostable with Docker Compose.

## Get started (no signup)
\`\`\`
curl -X POST https://app.counted.dev/api/v0/provision
# -> { "clientKey": "ck_...", "claimUrl": "...", "dashboardUrl": "..." }
\`\`\`
Then install \`@counted/sdk\` and call \`track("signup", { plan: "pro" })\`.

## For agents
- llms.txt: https://counted.dev/llms.txt
- Full integration guide: https://counted.dev/llms-full.txt
- OpenAPI: https://counted.dev/openapi.json
- Auth: https://counted.dev/auth.md
- Pricing: https://counted.dev/pricing.md

## Links
- Docs: https://counted.dev/docs
- Compare: https://counted.dev/vs
- GitHub: https://github.com/iceglober/counted
`;

export function GET() {
  return markdown(CONTENT);
}
