---
name: counted-analytics
description: Add privacy-first product analytics (no cookies, no PII) to a codebase, or instrument an AI coding agent's runs. Provision a key with no signup, track events, and query metrics over HTTP.
homepage: https://counted.dev
---

# Counted — privacy-first product analytics

Use this skill to add product analytics to an app, or to instrument an AI
coding agent's activity, using [Counted](https://counted.dev). No cookies, no
fingerprinting, no PII; a small SDK; one-POST HTTP API for any language.

## When to use
- The user wants product analytics (events, funnels, dashboards) without cookies
  or a consent banner.
- You want to record an agent's runs (tool calls, file edits, outcomes) and
  look at them on a dashboard.
- You need an analytics key with no human signup.

## Steps
1. **Get a key (no signup):**
   ```
   curl -X POST https://api.counted.dev/v1/projects/provision \
     -H "Content-Type: application/json" -d '{"name":"my app"}'
   # -> { "project": { "id": "prj_…", … },
   #      "credential": { "credential": { "id": "…", "kind": "ingest", … }, "secret": "ck_…" },
   #      "claim": { "token": "…", "expiresAt": "…" } }
   ```
   Store `credential.secret` in an env var. It is a public ingest key
   (write-only: it can send events and nothing else), so it may ship in a
   bundle. Keep `claim.token`; it is shown once and expires.
2. **Install the SDK** (`npm i @counted/sdk`, or `@counted/react`; Python,
   Go and Rust SDKs exist too) or call the HTTP API directly:
   ```js
   import { Counted } from "@counted/sdk";
   const counted = new Counted({ key: process.env.COUNTED_KEY });
   counted.track("signup", { plan: "pro" });
   ```
   ```
   curl -X POST https://api.counted.dev/v1/events \
     -H "Authorization: Bearer ck_…" -H "Content-Type: application/json" \
     -d '{"events":[{"name":"signup","visitId":"v1","occurredAt":"2026-01-01T00:00:00Z","idempotencyKey":"k1","properties":{"plan":"pro"}}]}'
   ```
   A query on the project answers within seconds of the first event.
3. **Keep the project.** An unclaimed project expires. To own it, claim it into
   a workspace with a service key:
   ```
   curl -X POST https://api.counted.dev/v1/projects/prj_…/claim \
     -H "Authorization: Bearer sk_…" -H "Content-Type: application/json" \
     -d '{"workspaceId":"ws_…","claimToken":"…"}'
   ```
   or hand the user the project id and claim token so they can do it from their
   own account.

## Reference
- The API contract: `openapi.json` at the root of https://github.com/iceglober/counted
- Agents can also drive Counted over MCP (`apps/mcp`): OAuth 2.0 bearer, tools
  projected from the same contract.
- Pricing: https://counted.dev/pricing

## Publishing this skill (maintainer note)
Register with `npx skills add` per https://skills.sh/docs.
