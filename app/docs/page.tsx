import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "../(marketing)/site-chrome";
import { CodeTabs } from "@/components/code-tabs";
import { SdkVote } from "@/components/sdk-vote";

export const metadata: Metadata = {
  title: "Documentation — Counted",
  description:
    "Install an SDK, send an event, read the API. Product analytics with no cookies, no PII.",
  alternates: { canonical: "/docs" },
};

const QUICKSTART = [
  {
    label: "JavaScript",
    lang: "js",
    code: `npm install @counted/sdk

import { Analytics } from "@counted/sdk";

const counted = new Analytics({ projectKey: "ck_your_key" });
counted.track("signup", { plan: "pro" });
await counted.flush(); // before a short-lived process exits`,
  },
  {
    label: "React",
    lang: "react",
    code: `npm install @counted/react

import { AnalyticsProvider, useAnalytics } from "@counted/react";

// wrap your app
<AnalyticsProvider projectKey="ck_your_key">
  <App />
</AnalyticsProvider>;

// anywhere inside it
const { track } = useAnalytics();
track("signup", { plan: "pro" });`,
  },
  {
    label: "cURL",
    lang: "curl",
    code: `curl -X POST https://app.counted.dev/api/v0/event \\
  -H "project-key: ck_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"eventName":"signup","sessionId":"s_abc123","props":{"plan":"pro"}}'`,
  },
];

function H2({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20">
      {children}
    </h2>
  );
}

function NextLink({ href, title, blurb }: { href: string; title: string; blurb: string }) {
  return (
    <Link href={href} className="group block rounded-lg border border-border hover:border-border-hover p-4 transition-colors">
      <div className="font-medium text-sm group-hover:text-accent transition-colors">{title}</div>
      <div className="mt-1 text-sm text-text-secondary leading-relaxed">{blurb}</div>
    </Link>
  );
}

export default function DocsPage() {
  return (
    <>
      <p className="text-xs font-medium uppercase tracking-[0.15em] text-accent">Getting started</p>
      <h1 className="">Overview</h1>
      <p className="mt-3 text-text-secondary leading-relaxed">
        Counted is product analytics with no cookies, no fingerprinting, no PII. Send an event with
        an SDK or one HTTP call. Read it on a dashboard.
      </p>

      <H2>Get a project key</H2>
      <p className="mt-2 text-sm text-text-secondary leading-relaxed">
        Create a project and copy its write-only <code className="font-mono text-text-primary">ck_</code> key — or mint
        one from your terminal, no signup:
      </p>
      <div className="mt-3">
        <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
      </div>

      <H2 id="quickstart">Quickstart</H2>
      <p className="mt-2 text-sm text-text-secondary leading-relaxed">
        Pick your stack. Properties are plain values — strings, numbers, booleans. No field for a
        user id or email; Counted doesn&apos;t store them.
      </p>
      <div className="mt-4">
        <CodeTabs tabs={QUICKSTART} />
      </div>

      <H2 id="more-sdks">More SDKs — coming soon</H2>
      <p className="mt-2 text-sm text-text-secondary leading-relaxed">
        We release an SDK once it runs in a live example. JS/TS and React run counted.dev today;
        these are next. <strong className="text-text-primary">+1 the one you want</strong> and
        we&apos;ll prioritize by demand. Each vote is a Counted event.
      </p>
      <div className="mt-4">
        <SdkVote />
      </div>
      <p className="mt-3 text-xs text-text-tertiary">
        Need another language today? The{" "}
        <a href="/docs/api" className="text-accent hover:text-accent-hover transition-colors">HTTP API</a>{" "}
        is one POST — see the cURL tab above.
      </p>

      <H2>Next</H2>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NextLink href="/docs/api" title="API Reference →" blurb="Every endpoint: ingestion, projects, query, dashboards, alerts." />
        <NextLink href="/for/agents" title="Analytics for AI agents →" blurb="Native plugins for Claude Code and OpenCode." />
        <NextLink href="/blog" title="Blog →" blurb="Guides and notes on the privacy model, agents, and self-hosting." />
        <NextLink href="https://github.com/iceglober/counted#self-hosting" title="Self-host →" blurb="Run Counted on your own infra with Docker Compose." />
      </div>

      <p className="mt-10 text-sm text-text-tertiary">
        Machine-readable spec:{" "}
        <a href="/api/v0/openapi.json" className="text-accent hover:text-accent-hover transition-colors">/api/v0/openapi.json</a>
        {" "}(OpenAPI 3.1) · agent summary at{" "}
        <a href="/docs/llms.txt" className="text-accent hover:text-accent-hover transition-colors">/docs/llms.txt</a>.
      </p>
    </>
  );
}
