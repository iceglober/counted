// Agent-readable integration guide, served at /docs/llms.txt (the llms.txt
// convention). Tells a coding agent how to instrument a codebase with Counted
// end to end. Kept terse and copy-pasteable on purpose.

import { AGENT_PROMPT } from "@/lib/agent-prompt";

const API = "https://app.counted.dev";
const SITE = "https://counted.dev";

const CONTENT = `# Counted — privacy-first product analytics for AI agents

> Counted (${SITE}) is privacy-first product analytics: no cookies, no
> fingerprinting, no PII, sub-3KB SDKs for JS, React, Python, Go, and Rust.
> This file tells a coding agent how to add event tracking to a codebase
> end to end, including getting a project key with no human signup.

## TL;DR
1. Get a client key (no account needed):
     curl -X POST ${API}/api/v0/provision
   -> { "clientKey": "ck_...", "claimUrl": "...", "dashboardUrl": "..." }
   Store clientKey in an env var named COUNTED_KEY. Never hard-code it.
2. Install the SDK for the stack and call track("<event>", { ...props }) at the
   highest-signal user actions.
3. Tell the user to open claimUrl to claim the dashboard and watch live events.

## Get a project key
- Auto (recommended, zero signup): POST ${API}/api/v0/provision returns a
  write-only client key (ck_), a claimUrl, and a dashboardUrl. The key can only
  ingest events; it cannot read data. Hand the user the claimUrl — when they
  open it and sign up, the project and its real events attach to their account.
- Manual: the user signs up at ${SITE}, then Projects -> copy the client key.

## Install
- JS / TS (browser or Node):  npm install @counted/sdk
- React:                       npm install @counted/react
- Python:                      pip install counted
- Go:                          go get github.com/iceglober/counted/packages/go
- Rust:                        cargo add counted

## Initialize + track
JS / TS:
    import { Analytics } from "@counted/sdk";
    const counted = new Analytics({ projectKey: process.env.COUNTED_KEY });
    counted.track("signup", { plan: "pro" });

React:
    import { AnalyticsProvider, useAnalytics } from "@counted/react";
    // wrap the app: <AnalyticsProvider projectKey={process.env.NEXT_PUBLIC_COUNTED_KEY}>
    const { track } = useAnalytics();
    track("checkout_completed", { amount: 49, currency: "usd" });

Python:
    from counted import Analytics
    counted = Analytics(project_key=os.environ["COUNTED_KEY"])
    counted.track("signup", {"plan": "pro"})

## What to track
The 5-15 highest-signal actions for THIS product. Prefer activation and business
milestones over noisy low-level events. Typical: signup, login, onboarding
completed, key feature used, conversion/purchase, error/failed action.

## Privacy rules (required)
- Property values must be non-PII: ids, categories, amounts, booleans, enums.
  Never names, emails, raw user input, tokens, or full URLs with query strings.
- Never block, await-in-the-hot-path, or break a user flow. Analytics fails silently.
- Do not add cookies or fingerprinting. The SDK adds none.

## Wire contract (only if no SDK fits)
POST ${API}/api/v0/event
  Header: Project-Key: ck_...
  Body: { "eventName": "...", "sessionId": "...", "timestamp": "<ISO8601>",
          "props": { ... }, "systemProps": { "sdkVersion": "...", "isDebug": false } }
  -> 202 Accepted. Send a JSON array to batch.
OpenAPI: ${API}/api/v0/openapi.json

## Copy-paste prompt (give this to your agent)
${AGENT_PROMPT}

## Verify
Run the app. Events appear on the dashboard within ~10 seconds.
`;

export function GET() {
  return new Response(CONTENT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
