---
title: "Add product analytics to your SolidJS app in 5 minutes"
description: "Drop @counted/sdk into any SolidJS app, auto-track page views on every route change, and fire custom events — no cookies, under 3KB."
tags: solidjs, javascript, analytics, privacy, webdev
canonical_url: https://counted.dev/blog/solid-analytics-in-5-minutes
series: Analytics Quickstarts
published: false
---

`@counted/sdk` drops into any SolidJS app in a handful of lines — no cookie banner,
no consent wall, no 50KB bundle. Here's the whole setup.

## 1. Get a project key

Create a project and copy its `ck_` client key — or provision one without signing up:

```bash
curl -X POST https://app.counted.dev/api/v0/provision
```

Add it to your `.env`. SolidJS uses Vite, which exposes `VITE_`-prefixed vars to the browser bundle:

```
# .env
VITE_COUNTED_PROJECT_KEY=ck_your_project_key
```

Client keys are write-only — safe to ship in the browser.

## 2. Install

```bash
npm install @counted/sdk @solidjs/router
```

`@solidjs/router` is required for page-view tracking. If your project already uses it, skip the install.

## 3. Create an analytics module

Instantiate the SDK once and export the singleton — no React context needed.

```typescript
// src/analytics.ts
import { Analytics } from "@counted/sdk";

export const analytics = new Analytics(
  import.meta.env.VITE_COUNTED_PROJECT_KEY,
  { host: "https://app.counted.dev" }
);
```

## 4. Auto-track page views

SolidJS's `createEffect` re-runs reactively whenever its dependencies change. `useLocation()` from `@solidjs/router` is a reactive signal — accessing `location.pathname` inside an effect registers the dependency, so it fires on every route change automatically.

```tsx
// src/components/PageViews.tsx
import { createEffect } from "solid-js";
import { useLocation } from "@solidjs/router";
import { analytics } from "../analytics";

export function PageViews() {
  const location = useLocation();
  createEffect(() => {
    analytics.track("page_view", { path: location.pathname });
  });
  return null;
}
```

Render it inside your router in `src/App.tsx`:

```tsx
import { Router, Route } from "@solidjs/router";
import { PageViews } from "./components/PageViews";

export default function App() {
  return (
    <Router>
      <PageViews />
      <Route path="/" component={Home} />
    </Router>
  );
}
```

Every page your users visit now appears in the dashboard as a `page_view` event. Break it down by path, build funnels, or compare cohorts — all from the same event shape.

## 5. Track a custom event

Import the singleton in any component. Properties are plain values — no user IDs, no PII.

```tsx
// src/components/UpgradeButton.tsx
import { analytics } from "../analytics";

export function UpgradeButton() {
  return (
    <button onClick={() => analytics.track("upgrade_click", { plan: "pro" })}>
      Upgrade
    </button>
  );
}
```

Your event shows up on the dashboard within a second or two. Add as many properties as you want — breakdowns, time series, and funnels compose from whatever shape you send.

*Originally published on [counted.dev](https://counted.dev/blog/solid-analytics-in-5-minutes).*
