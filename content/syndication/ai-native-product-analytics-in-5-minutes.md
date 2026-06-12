---
title: Set up AI-native product analytics in 5 minutes
description: Install the SDK, send your first event, and read it on a live dashboard — no cookies, no PII, under 3KB gzipped.
tags: analytics, privacy, typescript, webdev
canonical_url: https://counted.dev/blog/ai-native-product-analytics-in-5-minutes
published: false
---

I'm tired of two things in an analytics setup: the cookie-consent banner, and the 50KB script that loads before my own app does. [Counted](https://counted.dev) has neither — and the same SDK also instruments your AI agents. Here's the five-minute version.

## Two lines to your first event

Grab a write-only client key. No signup required — mint one from your terminal (it returns a `ck_…` key plus a link to claim the project later):

```bash
curl -X POST https://app.counted.dev/api/v0/provision
```

Then install the zero-dependency SDK and send something:

```bash
npm install @counted/sdk
```

```ts
import { Analytics } from "@counted/sdk";

const counted = new Analytics({ projectKey: "ck_your_key" });
counted.track("signup", { plan: "free" });
```

Open the project and the event is there within a second or two. Properties are plain values — strings, numbers, booleans — and that's deliberate: there's no field for a user id or an email, because Counted doesn't store them.

## Why there's no cookie

The session id is generated in memory when the SDK starts and lives as long as the tab or process does. Nothing is written to a cookie, to localStorage, or to disk — when the session ends, it's gone. So you're counting *events and sessions*, not people.

That's the honest trade: you can't silently follow one human across devices and weeks — which, without consent, you shouldn't be able to anyway. What you get back is a number you can stand behind, GDPR/CCPA-friendly, and zero consent banners. For most product questions ("did this funnel improve?", "which feature gets used?") that's exactly the data you wanted.

## The one gotcha: flush before a short-lived process exits

The SDK batches events and flushes on a timer. In the browser it also flushes when the tab is hidden, so you rarely think about it. But in a **short-lived process** — a serverless function, a CLI, a cron job — the process can exit before that timer fires and drop the last batch. Flush explicitly before you exit:

```ts
counted.track("job_finished", { processed: 128 });
await counted.flush();   // don't lose the last batch
```

(This is the single thing people trip on. The browser and long-running servers handle it for you; ephemeral runtimes don't.)

## Same SDK, your agents too

Here's the agent part: an agent's actions are just events. `track("tool_use", { tool, outcome })` is the same shape as `track("signup", { plan })`. So you instrument your product *and* your AI coding agents with one SDK and read both in the same composable dashboards — funnels, breakdowns, time series.

If agents are why you're here, skip straight to [tracking a Claude Code eval in 5 minutes](https://counted.dev/blog/claude-code-eval-in-5-minutes) — same idea, with the native plugin doing the instrumentation for you.

That's it — instrumented and visible, no banner, no 50KB bundle, one event model for your users and your agents. From here you build the dashboard you want.

*Originally published on [counted.dev](https://counted.dev/blog/ai-native-product-analytics-in-5-minutes).*
