import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("nextjs-analytics-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        <code className="font-mono text-text-primary">@counted/react</code> drops into a Next.js App
        Router app without a 50KB script or a cookie banner. Here&apos;s the whole thing — provider,
        first event, and auto page views — in about five minutes.
      </Lead>

      <Step n={1} title="Get a project key">
        <P>
          Create a project and copy its <strong>client key</strong> (starts with{" "}
          <code className="font-mono text-text-primary">ck_</code>) — or mint one with no signup:
        </P>
        <div className="mt-3">
          <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
        </div>
        <P>
          Put it in your env as <code className="font-mono text-text-primary">NEXT_PUBLIC_COUNTED_PROJECT_KEY</code>.
          Client keys are write-only — safe to expose in the browser.
        </P>
      </Step>

      <Step n={2} title="Install the SDK">
        <div className="mt-1">
          <CodeBlock>{`npm install @counted/react`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Add the provider">
        <P>
          The provider is a client component. Wrap your app once — a small{" "}
          <code className="font-mono text-text-primary">providers.tsx</code> keeps your root layout a
          server component.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// app/providers.tsx
"use client";

import { AnalyticsProvider } from "@counted/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AnalyticsProvider
      projectKey={process.env.NEXT_PUBLIC_COUNTED_PROJECT_KEY!}
      host="https://app.counted.dev"
    >
      {children}
    </AnalyticsProvider>
  );
}`}</CodeBlock>
        </div>
        <div className="mt-3">
          <CodeBlock>{`// app/layout.tsx
import { Providers } from "./providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}`}</CodeBlock>
        </div>
      </Step>

      <Step n={4} title="Track an event">
        <P>Call <code className="font-mono text-text-primary">useAnalytics()</code> in any client component.</P>
        <div className="mt-3">
          <CodeBlock>{`"use client";

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
        <P>Properties are plain values — no user IDs or PII. Your event shows up on the dashboard within a second or two.</P>
      </Step>

      <Step n={5} title="Auto-track page views">
        <P>
          Drop a tiny client component near the root to record a view on every route change —
          App Router navigation is client-side, so a <code className="font-mono text-text-primary">usePathname</code> effect covers it.
        </P>
        <div className="mt-3">
          <CodeBlock>{`"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAnalytics } from "@counted/react";

export function PageViews() {
  const { track } = useAnalytics();
  const pathname = usePathname();
  useEffect(() => {
    track("page_view", { path: pathname });
  }, [pathname, track]);
  return null;
}`}</CodeBlock>
        </div>
        <P>Render <code className="font-mono text-text-primary">&lt;PageViews /&gt;</code> inside the provider, and you have route-level analytics — composable into funnels and breakdowns from there.</P>
      </Step>
    </PostLayout>
  );
}
