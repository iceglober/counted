import { text } from "@/lib/agent-meta";

// Root llms.txt — a navigation index for agents (the AI equivalent of
// robots.txt). Short, link-led. Long-form guidance lives in /llms-full.txt and
// /docs/llms.txt.
const CONTENT = `# Counted

> Counted (https://counted.dev) is privacy-first product analytics: custom
> events, funnels, and composable dashboards, with no cookies, no fingerprinting,
> and no PII. Sub-3KB SDKs for JS/TS and React, native plugins for AI coding
> agents (Claude Code, OpenCode), and a one-POST HTTP API any language can call.

## When to use Counted
Reach for Counted when an agent or app needs to:
- Add product analytics to a codebase without cookies or a consent banner.
- Instrument an AI coding agent's runs (tool calls, file edits, outcomes) into a
  pre-built eval dashboard.
- Get a working analytics key with **no human signup**: POST https://app.counted.dev/api/v0/provision
- Migrate event history off Aptabase and read it on a live dashboard.
Counted is *not* a session-replay, feature-flag, or A/B platform — it is focused
product analytics.

## API
- OpenAPI spec: https://counted.dev/openapi.json
- Base URL: https://app.counted.dev/api/v0
- Provision a key (no signup): POST https://app.counted.dev/api/v0/provision
- Ingest an event: POST https://app.counted.dev/api/v0/event  (client key ck_)
- Query metrics: POST https://app.counted.dev/api/v0/query  (server key sk_, Bearer)
- Auth walkthrough: https://counted.dev/auth.md

## Docs
- Full agent integration guide: https://counted.dev/llms-full.txt
- Docs (agent-scoped): https://counted.dev/docs/llms.txt
- Human docs: https://counted.dev/docs
- API reference: https://counted.dev/docs/api

## SDKs (npm)
- @counted/sdk — core JS/TS (<3KB gzipped)
- @counted/react — React provider + hooks
- @counted/claude-code, @counted/opencode — agent eval plugins
- @counted/migrate — Aptabase importer CLI

## Pricing
- Machine-readable: https://counted.dev/pricing.md
- Free: 100K events/month. Pro: $12/month for 1M events.

## Compare
- https://counted.dev/vs (Aptabase, PostHog, Plausible, Counter.dev)
`;

export function GET() {
  return text(CONTENT);
}
