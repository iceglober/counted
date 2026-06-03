---
title: Set up AI-native product analytics in 5 minutes
description: Install the SDK, send your first event, and read it on a live dashboard — no cookies, no PII, under 3KB.
tags: analytics, privacy, typescript, webdev
canonical_url: https://counted.dev/blog/ai-native-product-analytics-in-5-minutes
published: false
---

Most analytics setups make you wire a consent banner before you can see a single number. [Counted](https://counted.dev) doesn't — no cookies, no PII, under 3KB. Here's the whole thing, start to live dashboard, in about five minutes.

## 1. Get a project key

Create a project and copy its **client key** — it starts with `ck_`. Client keys are write-only and safe to ship in browser or app code; they can send events but can't read your data. (No signup? Mint one from your terminal: `curl -X POST https://app.counted.dev/api/v0/provision`.)

## 2. Install the SDK

The core SDK is zero-dependency and works in any JS runtime.

```bash
npm install @counted/sdk
# or: bun add @counted/sdk
```

## 3. Initialize and send your first event

Create the client once, then track named events with whatever properties you care about.

```ts
import { Analytics } from "@counted/sdk";

const counted = new Analytics({
  projectKey: "ck_your_project_key",
  host: "https://app.counted.dev",
});

counted.track("signup", { plan: "free", referrer: "blog" });
```

Properties are plain values — strings, numbers, booleans. No user IDs, no emails, nothing that identifies a person. Sessions are ephemeral and in-memory only.

## 4. Watch it land on a dashboard

Open your project and you'll see the event arrive within a second or two. Add an insight — a count of `signup` broken down by `plan`, say — and you have a composable dashboard you can keep building on. Funnels and retention work the same way.

## 5. (Optional) Auto-track a React or SPA app

For a single-page app, `@counted/react` can emit a page view on every route change, so you don't hand-instrument navigation.

```bash
npm install @counted/react
```

That's it — instrumented, sending, and visible, without a cookie banner or a 50KB bundle. From here, compose the dashboard you actually want.

*Originally published on [counted.dev](https://counted.dev/blog/ai-native-product-analytics-in-5-minutes).*
