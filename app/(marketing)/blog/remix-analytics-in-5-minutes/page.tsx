import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("remix-analytics-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        <code className="font-mono text-text-primary">@counted/react</code> drops into any
        Remix v2 app without a cookie banner or a 50KB script. Here&apos;s the whole thing:
        a provider, auto page views on every route, and a custom event, in about five
        minutes.
      </Lead>

      <Step n={1} title="Get a project key">
        <P>
          Create a project and copy its <strong>client key</strong> (starts with{" "}
          <code className="font-mono text-text-primary">ck_</code>) — or mint one with no
          signup:
        </P>
        <div className="mt-3">
          <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
        </div>
        <P>
          Add it to your{" "}
          <code className="font-mono text-text-primary">.env</code>. Remix v2 uses the
          Vite plugin, which exposes{" "}
          <code className="font-mono text-text-primary">VITE_</code>-prefixed vars to the
          browser bundle:
        </P>
        <div className="mt-3">
          <CodeBlock>{`# .env
VITE_COUNTED_PROJECT_KEY=ck_your_project_key`}</CodeBlock>
        </div>
        <P>Client keys are write-only — safe to ship in the browser.</P>
      </Step>

      <Step n={2} title="Install the SDK">
        <div className="mt-1">
          <CodeBlock>{`npm install @counted/react`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Add the provider to your root layout">
        <P>
          Remix renders all routes through{" "}
          <code className="font-mono text-text-primary">app/root.tsx</code>. Wrap the{" "}
          <code className="font-mono text-text-primary">&lt;Outlet /&gt;</code> with{" "}
          <code className="font-mono text-text-primary">AnalyticsProvider</code> once —
          every route your app renders will inherit it.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// app/root.tsx
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
}`}</CodeBlock>
        </div>
      </Step>

      <Step n={4} title="Auto-track page views">
        <P>
          Create a small component that reads the current location and fires a{" "}
          <code className="font-mono text-text-primary">page_view</code> event whenever
          the route changes. Remix&apos;s{" "}
          <code className="font-mono text-text-primary">useLocation()</code> updates on
          every client-side navigation — the same hook that powers{" "}
          <code className="font-mono text-text-primary">active</code> link styling.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// app/components/page-views.tsx
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
}`}</CodeBlock>
        </div>
        <P>
          Render it inside the provider in{" "}
          <code className="font-mono text-text-primary">root.tsx</code>:
        </P>
        <div className="mt-3">
          <CodeBlock>{`import { PageViews } from "./components/page-views";

// Inside App(), inside <AnalyticsProvider>:
<AnalyticsProvider
  projectKey={import.meta.env.VITE_COUNTED_PROJECT_KEY}
  host="https://app.counted.dev"
>
  <PageViews />
  <Outlet />
</AnalyticsProvider>`}</CodeBlock>
        </div>
        <P>
          Every page your users visit now appears in the dashboard as a{" "}
          <code className="font-mono text-text-primary">page_view</code> event. Break it
          down by path, build funnels, or compare cohorts — all from the same event shape.
        </P>
      </Step>

      <Step n={5} title="Track a custom event">
        <P>
          Call <code className="font-mono text-text-primary">useAnalytics()</code> in any
          component inside the provider. Properties are plain values — no user IDs, no PII.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// app/components/upgrade-button.tsx
import { useAnalytics } from "@counted/react";

export function UpgradeButton() {
  const { track } = useAnalytics();
  return (
    <button onClick={() => track("upgrade_click", { plan: "pro" })}>
      Upgrade
    </button>
  );
}`}</CodeBlock>
        </div>
        <P>
          Your event shows up on the dashboard within a second or two. Add as many
          properties as you want — breakdowns, time series, and funnels compose from
          whatever shape you send.
        </P>
      </Step>
    </PostLayout>
  );
}
