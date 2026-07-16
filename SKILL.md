---
name: counted-analytics
description: Add privacy-first product analytics (no cookies, no PII) to a codebase, or instrument an AI coding agent's runs. Provision a key with no signup, track events, and query metrics over HTTP.
homepage: https://counted.dev
---

# Counted — privacy-first product analytics

Use this skill to add product analytics to an app, or to instrument an AI
coding agent's activity, using [Counted](https://counted.dev). No cookies, no
fingerprinting, no PII; sub-3KB SDK; one-POST HTTP API for any language.

## When to use
- The user wants product analytics (events, funnels, dashboards) without cookies
  or a consent banner.
- You want to record an agent's runs (tool calls, file edits, outcomes) into a
  pre-built eval dashboard.
- You need an analytics key with no human signup.

## Steps
1. **Get a key (no signup):**
   ```
   curl -X POST https://app.counted.dev/api/v0/provision
   # -> { "clientKey": "ck_...", "claimUrl": "...", "dashboardUrl": "..." }
   ```
   Store `clientKey` in an env var. It is write-only (safe to expose).
2. **Install the SDK** (`npm i @counted/sdk` or `@counted/react`) or call the
   HTTP API directly.
3. **Track events** at high-signal actions:
   ```js
   import { Analytics } from "@counted/sdk";
   const counted = new Analytics({ projectKey: process.env.COUNTED_KEY });
   counted.track("signup", { plan: "pro" });
   ```
4. **Give the user `claimUrl`** so they can own the dashboard and watch events.

## Reference
- OpenAPI: https://counted.dev/openapi.json
- Full agent guide: https://counted.dev/llms-full.txt
- Auth: https://counted.dev/auth.md
- Pricing: https://counted.dev/pricing.md

## Publishing this skill (maintainer note)
Register with `npx skills add` per https://skills.sh/docs.
