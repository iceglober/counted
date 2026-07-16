import { text } from "@/lib/agent-meta";

// Long-form agent integration guide. /llms.txt is the short index; this is the
// full manual an agent can follow end to end.
const CONTENT = `# Counted — full agent integration guide

Counted is privacy-first product analytics: custom events, funnels, and
composable dashboards with no cookies, no fingerprinting, and no PII. Sessions
are ephemeral (in-memory, ~30 min) and never a stored identity. GDPR/CCPA-friendly
with no consent banner. Open source and self-hostable.

Base URL: https://app.counted.dev/api/v0
OpenAPI:  https://counted.dev/openapi.json
Auth:     https://counted.dev/auth.md

## 1. Get a key (no signup)
    curl -X POST https://app.counted.dev/api/v0/provision
    # -> { "clientKey": "ck_...", "claimUrl": "...", "dashboardUrl": "..." }
Store clientKey in an env var (e.g. COUNTED_KEY). It is write-only: it can ingest
events but cannot read data, so it is safe in a browser or an agent. Give the
human claimUrl to own the dashboard; the key works before and after claiming.

## 2. Install an SDK
- JS/TS:  npm i @counted/sdk
- React:  npm i @counted/react
- Any language: call the HTTP API directly (section 4).
- Agent eval plugins: @counted/claude-code, @counted/opencode.

JS/TS:
    import { Analytics } from "@counted/sdk";
    const counted = new Analytics({ projectKey: process.env.COUNTED_KEY });
    counted.track("signup", { plan: "pro" });
    await counted.flush(); // before a short-lived process exits

React:
    import { AnalyticsProvider, useAnalytics } from "@counted/react";
    // wrap your app in <AnalyticsProvider projectKey={key} autoTrack>
    // then const { track } = useAnalytics();

## 3. What to track
Instrument the highest-signal user actions: signup, activation, key feature use,
purchase, and funnel steps. Properties are plain values (strings, numbers,
booleans). There is no field for a user id or email — Counted does not store them.

## 4. HTTP API (any language)
Ingest one event or a batch of up to 50:
    POST https://app.counted.dev/api/v0/event
    Project-Key: ck_...
    Content-Type: application/json
    {"eventName":"signup","sessionId":"<stable-per-visit-id>","props":{"plan":"pro"}}
Returns 202 on accept. Bad input returns 400 (JSON error). An sk_ key on ingest
returns 403.

Read metrics with a server key (Bearer):
    POST https://app.counted.dev/api/v0/query
    Authorization: Bearer sk_...
    {"projectId":"...","measure":"count","eventFilter":{"names":["signup"]}}

## 5. Agents: instrument your own runs
The same event model fits an AI coding agent. Pass a stable session id per run
and track tool calls / outcomes:
    counted.track("tool_use", { tool: "edit_file", outcome: "success" });
Or install the native plugin (@counted/claude-code, @counted/opencode) to get a
pre-built eval dashboard with no code. File paths are repo-relative, commands are
binary-name only, and no code contents leave the machine.

## 6. Migrate from Aptabase
    npx @counted/migrate --source-clickhouse "<url>" --app-id "<id>" \\
      --target-key "ck_..." --target-host "https://app.counted.dev"
History imports and lights up the dashboard immediately.

## Errors
All errors are JSON: {"error":"<message>"} with a 4xx status. 400 = bad input,
401 = missing/invalid read key, 403 = wrong key type or over quota.

## Pricing
Free: 100K events/mo. Pro: $12/mo for 1M. https://counted.dev/pricing.md

## More
- Docs: https://counted.dev/docs
- API reference: https://counted.dev/docs/api
- Compare: https://counted.dev/vs
- GitHub: https://github.com/iceglober/counted
`;

export function GET() {
  return text(CONTENT);
}
