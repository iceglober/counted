import { markdown } from "@/lib/agent-meta";

// Markdown twin of the llms.txt index (some agents probe /llms.md specifically).
const CONTENT = `# Counted

Privacy-first product analytics: custom events, funnels, and composable
dashboards with no cookies, no fingerprinting, and no PII. Under 3KB gzipped;
the same SDK instruments your product and your AI coding agents.

## When to use
- Add product analytics to a codebase with no cookies or consent banner.
- Instrument an AI coding agent's runs into a pre-built eval dashboard.
- Get an analytics key with no human signup (POST /api/v0/provision).

## Key links
- Agent index: https://counted.dev/llms.txt
- Full guide: https://counted.dev/llms-full.txt
- OpenAPI: https://counted.dev/openapi.json
- Auth: https://counted.dev/auth.md
- Pricing: https://counted.dev/pricing.md
- Docs: https://counted.dev/docs
`;

export function GET() {
  return markdown(CONTENT);
}
