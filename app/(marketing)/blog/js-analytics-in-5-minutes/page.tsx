import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../site-chrome";

export const metadata: Metadata = {
  title: "Add product analytics to your JavaScript app in 5 minutes | Counted",
  description:
    "Drop @counted/sdk into any Vite-based JavaScript app, track page views, and fire custom events — no framework, no cookies, under 3KB gzipped.",
  openGraph: {
    title: "Add product analytics to your JavaScript app in 5 minutes",
    description:
      "Drop @counted/sdk into any Vite-based JavaScript app, track page views, and fire custom events — no framework, no cookies, under 3KB gzipped.",
    url: "https://counted.dev/blog/js-analytics-in-5-minutes",
  },
};

export default function JsAnalyticsPost() {
  return (
    <article className="prose prose-neutral dark:prose-invert max-w-2xl mx-auto py-16 px-4">
      <p className="text-sm text-muted-foreground uppercase tracking-wide mb-2">
        Quickstart · 5 min
      </p>
      <h1>Add product analytics to your JavaScript app in 5 minutes</h1>
      <p className="lead">
        No React, no Vue, no Svelte — just{" "}
        <code>{`@counted/sdk`}</code> dropped into your Vite project. A module,
        a page-view call, and a custom event. Here&apos;s the whole setup.
      </p>

      <h2>1. Get a project key</h2>
      <p>
        Create a project and copy its <code>ck_</code> client key — or
        provision one without signing up:
      </p>
      <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
      <p>
        Add it to your <code>.env</code>. Vite exposes{" "}
        <code>VITE_</code>-prefixed variables to the browser bundle:
      </p>
      <CodeBlock>{`# .env
VITE_COUNTED_PROJECT_KEY=ck_your_project_key`}</CodeBlock>
      <p>Client keys are write-only — safe to ship in the browser.</p>

      <h2>2. Install</h2>
      <CodeBlock>{`npm install @counted/sdk`}</CodeBlock>

      <h2>3. Create an analytics module</h2>
      <p>
        Instantiate the SDK once and export the singleton. Import it wherever
        you need it — no framework context required.
      </p>
      <CodeBlock>{`// src/analytics.js
import { Analytics } from "@counted/sdk";

export const analytics = new Analytics(
  import.meta.env.VITE_COUNTED_PROJECT_KEY,
  { host: "https://app.counted.dev" }
);`}</CodeBlock>

      <h2>4. Track page views</h2>
      <p>
        For a traditional multi-page site, fire a{" "}
        <code>page_view</code> event when the page loads:
      </p>
      <CodeBlock>{`// src/main.js
import { analytics } from "./analytics.js";

// Fire on initial load
analytics.track("page_view", { path: window.location.pathname });`}</CodeBlock>
      <p>
        Building a single-page app with the History API? Add a{" "}
        <code>popstate</code> listener to catch client-side navigations too:
      </p>
      <CodeBlock>{`// src/main.js
import { analytics } from "./analytics.js";

function trackPage() {
  analytics.track("page_view", { path: window.location.pathname });
}

trackPage(); // initial load

// Client-side navigation (pushState / popstate)
window.addEventListener("popstate", trackPage);

// If you use pushState directly, wrap it:
const originalPushState = history.pushState.bind(history);
history.pushState = (...args) => {
  originalPushState(...args);
  trackPage();
};`}</CodeBlock>
      <p>
        Every page visit now appears in your dashboard as a{" "}
        <code>page_view</code> event. Break it down by path, build funnels,
        or compare cohorts — all from the same event shape.
      </p>

      <h2>5. Track a custom event</h2>
      <p>
        Import the singleton anywhere and call <code>track()</code>. Properties
        are plain values — no user IDs, no PII.
      </p>
      <CodeBlock>{`// src/components/upgrade-button.js
import { analytics } from "../analytics.js";

document.querySelector("#upgrade-btn").addEventListener("click", () => {
  analytics.track("upgrade_click", { plan: "pro" });
});`}</CodeBlock>
      <p>
        Your event shows up on the dashboard within a second or two. Add as
        many properties as you want — breakdowns, time series, and funnels
        compose from whatever shape you send.
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        Using a framework?{" "}
        <Link href="/blog/nextjs-analytics-in-5-minutes">Next.js</Link> ·{" "}
        <Link href="/blog/vue-analytics-in-5-minutes">Vue 3</Link> ·{" "}
        <Link href="/blog/sveltekit-analytics-in-5-minutes">SvelteKit</Link> ·{" "}
        <Link href="/blog/astro-analytics-in-5-minutes">Astro</Link> ·{" "}
        <Link href="/blog">See all quickstarts.</Link>
      </p>
    </article>
  );
}
