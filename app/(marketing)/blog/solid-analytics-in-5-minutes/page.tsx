import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../../site-chrome";

export const metadata: Metadata = {
  title: "Add product analytics to your SolidJS app in 5 minutes | Counted",
  description:
    "Drop @counted/sdk into any SolidJS app, auto-track page views on every route change, and fire custom events — no cookies, under 3KB gzipped.",
  openGraph: {
    title: "Add product analytics to your SolidJS app in 5 minutes",
    description:
      "Drop @counted/sdk into any SolidJS app, auto-track page views on every route change, and fire custom events — no cookies, under 3KB gzipped.",
    url: "https://counted.dev/blog/solid-analytics-in-5-minutes",
  },
};

export default function SolidAnalyticsPost() {
  return (
    <article className="prose prose-neutral dark:prose-invert max-w-2xl mx-auto py-16 px-4">
      <p className="text-sm text-muted-foreground uppercase tracking-wide mb-2">
        Quickstart · 5 min
      </p>
      <h1>Add product analytics to your SolidJS app in 5 minutes</h1>
      <p className="lead">
        {`@counted/sdk`} drops into any SolidJS app in a handful of lines — no
        cookie banner, no consent wall, no 50KB bundle. Here&apos;s the whole setup.
      </p>

      <h2>1. Get a project key</h2>
      <p>
        Create a project and copy its <code>ck_</code> client key — or provision
        one without signing up:
      </p>
      <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
      <p>
        Add it to your <code>.env</code>. SolidJS uses Vite, which exposes{" "}
        <code>VITE_</code>-prefixed vars to the browser bundle:
      </p>
      <CodeBlock>{`# .env
VITE_COUNTED_PROJECT_KEY=ck_your_project_key`}</CodeBlock>
      <p>Client keys are write-only — safe to ship in the browser.</p>

      <h2>2. Install</h2>
      <CodeBlock>{`npm install @counted/sdk @solidjs/router`}</CodeBlock>
      <p>
        <code>@solidjs/router</code> is required for the page-view tracking in
        Step 4. If your project already uses it, skip the install.
      </p>

      <h2>3. Create an analytics module</h2>
      <p>
        Instantiate the SDK once and export the singleton. Any file in your app
        can import it — no React context needed.
      </p>
      <CodeBlock>{`// src/analytics.ts
import { Analytics } from "@counted/sdk";

export const analytics = new Analytics(
  import.meta.env.VITE_COUNTED_PROJECT_KEY,
  { host: "https://app.counted.dev" }
);`}</CodeBlock>

      <h2>4. Auto-track page views</h2>
      <p>
        SolidJS&apos;s <code>createEffect</code> re-runs reactively whenever its
        dependencies change. <code>useLocation()</code> from{" "}
        <code>@solidjs/router</code> is a reactive signal — accessing{" "}
        <code>location.pathname</code> inside an effect registers the dependency,
        so it fires on every route change automatically.
      </p>
      <p>
        Create a small component and place it inside{" "}
        <code>{"<Router>"}</code> in your root:
      </p>
      <CodeBlock>{`// src/components/PageViews.tsx
import { createEffect } from "solid-js";
import { useLocation } from "@solidjs/router";
import { analytics } from "../analytics";

export function PageViews() {
  const location = useLocation();
  createEffect(() => {
    analytics.track("page_view", { path: location.pathname });
  });
  return null;
}`}</CodeBlock>
      <CodeBlock>{`// src/App.tsx
import { Router, Route } from "@solidjs/router";
import { PageViews } from "./components/PageViews";
import { Home } from "./pages/Home";

export default function App() {
  return (
    <Router>
      <PageViews />
      <Route path="/" component={Home} />
      {/* other routes */}
    </Router>
  );
}`}</CodeBlock>
      <p>
        Every page your users visit now appears in the dashboard as a{" "}
        <code>page_view</code> event. Break it down by path, build funnels, or
        compare cohorts — all from the same event shape.
      </p>

      <h2>5. Track a custom event</h2>
      <p>
        Import the analytics singleton in any component. Properties are plain
        values — no user IDs, no PII.
      </p>
      <CodeBlock>{`// src/components/UpgradeButton.tsx
import { analytics } from "../analytics";

export function UpgradeButton() {
  return (
    <button onClick={() => analytics.track("upgrade_click", { plan: "pro" })}>
      Upgrade
    </button>
  );
}`}</CodeBlock>
      <p>
        Your event shows up on the dashboard within a second or two. Add as many
        properties as you want — breakdowns, time series, and funnels compose
        from whatever shape you send.
      </p>

      <hr />
      <p className="text-sm text-muted-foreground">
        Using React instead?{" "}
        <Link href="/blog/nextjs-analytics-in-5-minutes">
          Next.js quickstart
        </Link>{" "}
        ·{" "}
        <Link href="/blog/react-vite-analytics-in-5-minutes">
          React + Vite quickstart
        </Link>
        . Using a different framework?{" "}
        <Link href="/blog">See all quickstarts.</Link>
      </p>
    </article>
  );
}
