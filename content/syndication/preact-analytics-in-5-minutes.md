---
title: "Add product analytics to your Preact app in 5 minutes"
description: "Drop @counted/sdk into any Preact + Vite app, auto-track page views on every route, and fire custom events — no cookies, under 3KB."
tags: preact, javascript, analytics, privacy, vite
canonical_url: https://counted.dev/blog/preact-analytics-in-5-minutes
series: Analytics Quickstarts
published: false
---

`@counted/sdk` drops into any Preact app in a handful of lines — no cookie
banner, no consent wall, no 50KB bundle. Here's the whole setup.

## 1. Get a project key

Create a project and copy its `ck_` client key — or provision one without
signing up:

```bash
curl -X POST https://app.counted.dev/api/v0/provision
```

Add it to your `.env`. Preact's default Vite template exposes `VITE_`-prefixed
vars to the browser bundle:

```
# .env
VITE_COUNTED_PROJECT_KEY=ck_your_project_key
```

Client keys are write-only — safe to ship in the browser.

## 2. Install

```bash
npm install @counted/sdk
```

## 3. Create an analytics module

Create a singleton at `src/analytics.ts`. Import it anywhere in your app — no
context or provider needed.

```ts
// src/analytics.ts
import { Analytics } from "@counted/sdk";

export const analytics = new Analytics({
  projectKey: import.meta.env.VITE_COUNTED_PROJECT_KEY,
  host: "https://app.counted.dev",
});
```

## 4. Auto-track page views

Create a component that fires a `page_view` event whenever the route changes.
`preact-iso`'s `useLocation()` updates on every client-side navigation.

```tsx
// src/components/PageViews.tsx
import { useEffect } from "preact/hooks";
import { useLocation } from "preact-iso";
import { analytics } from "../analytics";

export function PageViews() {
  const { url } = useLocation();
  useEffect(() => {
    analytics.track("page_view", { path: url });
  }, [url]);
  return null;
}
```

Render it once inside your root `<LocationProvider>` in `src/index.tsx`:

```tsx
import { LocationProvider, Router, Route } from "preact-iso";
import { PageViews } from "./components/PageViews";
import { Home } from "./pages/Home";

export function App() {
  return (
    <LocationProvider>
      <PageViews />
      <Router>
        <Route path="/" component={Home} />
      </Router>
    </LocationProvider>
  );
}
```

Every page your users visit now appears in the dashboard as a `page_view` event.
Break it down by path, build funnels, or compare cohorts — all from the same
event shape.

## 5. Track a custom event

Import the singleton in any component and call `track()`. Properties are plain
values — no user IDs, no PII.

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

Your event shows up on the dashboard within a second or two. Add as many
properties as you want — breakdowns, time series, and funnels compose from
whatever shape you send.

*Originally published on [counted.dev](https://counted.dev/blog/preact-analytics-in-5-minutes).*
