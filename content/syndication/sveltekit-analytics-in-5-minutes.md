---
title: Add product analytics to your SvelteKit app in 5 minutes
description: Drop @counted/sdk into any SvelteKit app, auto-track page views across routes, and fire custom events — no cookies, under 3KB gzipped.
tags: sveltekit, svelte, analytics, privacy, webdev
canonical_url: https://counted.dev/blog/sveltekit-analytics-in-5-minutes
published: false
---

[Counted](https://counted.dev) drops into any SvelteKit app in a handful of lines — no cookie banner, no consent wall, no 50KB bundle. Here's the whole setup.

## 1. Get a project key

Create a project and copy its `ck_` client key — or provision one without signing up:

```bash
curl -X POST https://app.counted.dev/api/v0/provision
```

Add it to `.env` with the `PUBLIC_` prefix so SvelteKit exposes it in the browser bundle:

```
PUBLIC_COUNTED_PROJECT_KEY=ck_your_project_key
```

## 2. Install

```bash
npm install @counted/sdk
```

## 3. Create a shared analytics module

```ts
// src/lib/analytics.ts
import { browser } from '$app/environment';
import { Analytics } from '@counted/sdk';
import { PUBLIC_COUNTED_PROJECT_KEY } from '$env/static/public';

export const analytics = browser
  ? new Analytics({ projectKey: PUBLIC_COUNTED_PROJECT_KEY })
  : null;
```

The `browser` guard prevents `Analytics` from running during SSR where `window` doesn't exist.

## 4. Auto-track page views

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { afterNavigate } from '$app/navigation';
  import { analytics } from '$lib/analytics';

  let { children } = $props();

  afterNavigate(({ to }) => {
    analytics?.track('page_view', { path: to?.url.pathname ?? '/' });
  });
</script>

{@render children()}
```

`afterNavigate` fires on mount and on every subsequent client-side navigation — one hook covers both.

## 5. Track a custom event

```svelte
<!-- src/lib/UpgradeButton.svelte -->
<script>
  import { analytics } from '$lib/analytics';
</script>

<button onclick={() => analytics?.track('upgrade_click', { plan: 'pro' })}>
  Upgrade
</button>
```

Properties are plain values — no user IDs, no PII. Events appear on the dashboard within a second or two.

*Originally published on [counted.dev](https://counted.dev/blog/sveltekit-analytics-in-5-minutes).*
