---
title: "Add product analytics to your JavaScript app in 5 minutes"
description: "Drop @counted/sdk into any Vite-based JavaScript app, track page views, and fire custom events — no framework, no cookies, under 3KB."
tags: javascript, analytics, privacy, webdev, vite
canonical_url: https://counted.dev/blog/js-analytics-in-5-minutes
series: Analytics Quickstarts
published: false
---

`@counted/sdk` drops into any JavaScript project in a handful of lines — no React, no
Vue, no Svelte needed. No cookie banner, no consent wall, no 50KB bundle. Here’s the
whole setup for a Vite project.

## 1. Get a project key

Create a project and copy its `ck_` client key — or provision one without signing up:

```bash
curl -X POST https://app.counted.dev/api/v0/provision
```

Add it to your `.env`. Vite exposes `VITE_`-prefixed variables to the browser bundle:

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

Instantiate the SDK once and export the singleton — importable from anywhere with no
framework context needed.

```javascript
// src/analytics.js
import { Analytics } from "@counted/sdk";

export const analytics = new Analytics(
  import.meta.env.VITE_COUNTED_PROJECT_KEY,
  { host: "https://app.counted.dev" }
);
```

## 4. Track page views

For a traditional multi-page site, fire on load:

```javascript
// src/main.js
import { analytics } from "./analytics.js";

analytics.track("page_view", { path: window.location.pathname });
```

Building a single-page app with the History API? Add navigation tracking too:

```javascript
// src/main.js
import { analytics } from "./analytics.js";

function trackPage() {
  analytics.track("page_view", { path: window.location.pathname });
}

trackPage(); // initial load

window.addEventListener("popstate", trackPage);

const originalPushState = history.pushState.bind(history);
history.pushState = (...args) => {
  originalPushState(...args);
  trackPage();
};
```

Every page visit now appears in your dashboard as a `page_view` event. Break it down
by path, build funnels, or compare cohorts — all from the same event shape.

## 5. Track a custom event

Import the singleton anywhere and call `track()`. Properties are plain values — no
user IDs, no PII.

```javascript
// src/components/upgrade-button.js
import { analytics } from "../analytics.js";

document.querySelector("#upgrade-btn").addEventListener("click", () => {
  analytics.track("upgrade_click", { plan: "pro" });
});
```

Your event shows up on the dashboard within a second or two.

*Originally published on [counted.dev](https://counted.dev/blog/js-analytics-in-5-minutes).*
