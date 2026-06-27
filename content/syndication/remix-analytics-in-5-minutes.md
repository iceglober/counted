---
title: "Add product analytics to your Remix app in 5 minutes"
description: "Drop @counted/react into any Remix v2 app, auto-track page views on every route, and fire custom events — no cookies, under 3KB."
tags: remix, react, javascript, analytics, privacy
canonical_url: https://counted.dev/blog/remix-analytics-in-5-minutes
series: Analytics Quickstarts
published: false
---

`@counted/react` drops into any Remix v2 app in a handful of lines — no cookie banner,
no consent wall, no 50KB bundle. Here's the whole setup.

## 1. Get a project key

Create a project and copy its `ck_` client key — or provision one without signing up:

```bash
curl -X POST https://app.counted.dev/api/v0/provision
```

Add it to your `.env`. Remix v2 uses the Vite plugin, which exposes `VITE_`-prefixed vars to the browser bundle:

```
# .env
VITE_COUNTED_PROJECT_KEY=ck_your_project_key
```

Client keys are write-only — safe to ship in the browser.

## 2. Install

```bash
npm install @counted/react
```

## 3. Add the provider to your root layout

Remix renders all routes through `app/root.tsx`. Wrap the `<Outlet />` with `AnalyticsProvider` once — every route your app renders will inherit it.

```tsx
// app/root.tsx
import { Outlet, Scripts, ScrollRestoration } from "@remix-run/react";
import { AnalyticsProvider } from "@counted/react";

export default function App() {
  return (
    <html lang="en">
      <head />
      <body>
        <AnalyticsProvider
          projectKey={import.meta.env.VITE_COUNTED_PROJECT_KEY}
          host="https://app.counted.dev"
        >
          <Outlet />
        </AnalyticsProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
```

## 4. Auto-track page views

Create a small component that fires a `page_view` event whenever the route changes. Remix's `useLocation()` updates on every client-side navigation.

```tsx
// app/components/page-views.tsx
import { useEffect } from "react";
import { useLocation } from "@remix-run/react";
import { useAnalytics } from "@counted/react";

export function PageViews() {
  const { track } = useAnalytics();
  const { pathname } = useLocation();
  useEffect(() => {
    track("page_view", { path: pathname });
  }, [pathname, track]);
  return null;
}
```

Render it inside the provider in `root.tsx`:

```tsx
import { PageViews } from "./components/page-views";

// Inside App(), inside <AnalyticsProvider>:
<AnalyticsProvider
  projectKey={import.meta.env.VITE_COUNTED_PROJECT_KEY}
  host="https://app.counted.dev"
>
  <PageViews />
  <Outlet />
</AnalyticsProvider>
```

Every page your users visit now appears in the dashboard as a `page_view` event. Break it down by path, build funnels, or compare cohorts — all from the same event shape.

## 5. Track a custom event

Call `useAnalytics()` in any component inside the provider. Properties are plain values — no user IDs, no PII.

```tsx
// app/components/upgrade-button.tsx
import { useAnalytics } from "@counted/react";

export function UpgradeButton() {
  const { track } = useAnalytics();
  return (
    <button onClick={() => track("upgrade_click", { plan: "pro" })}>
      Upgrade
    </button>
  );
}
```

Your event shows up on the dashboard within a second or two. Add as many properties as you want — breakdowns, time series, and funnels compose from whatever shape you send.

*Originally published on [counted.dev](https://counted.dev/blog/remix-analytics-in-5-minutes).*
