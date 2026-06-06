import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav, SiteFooter, CodeBlock } from "../(marketing)/site-chrome";
import { CodeTabs } from "@/components/code-tabs";

export const metadata: Metadata = {
  title: "Documentation — Counted",
  description:
    "Get started with Counted: install an SDK, send your first event, and explore the full API. Privacy-first product analytics — no cookies, no PII.",
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
    label: "Python",
    lang: "python",
    code: `pip install counted

import counted

counted.init("ck_your_key")
counted.track("signup", {"plan": "pro"})`,
  },
  {
    label: "Go",
    lang: "go",
    code: `go get github.com/iceglober/counted/packages/go

import counted "github.com/iceglober/counted/packages/go"

counted.Init(counted.Options{ProjectKey: "ck_your_key"})
defer counted.DestroyGlobal() // flush on exit

counted.TrackEvent("signup", counted.EventProperties{"plan": "pro"})`,
  },
  {
    label: "Rust",
    lang: "rust",
    code: `# Cargo.toml — imported as \`counted\`
counted-sdk = "0.1"

use counted::Analytics;

let analytics = Analytics::new("ck_your_key");
analytics.track("signup", Some([("plan".into(), "pro".into())].into()));
analytics.flush(); // or let it flush on drop`,
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

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-12 font-display text-xl md:text-2xl tracking-tight">{children}</h2>;
}

function NextLink({ href, title, blurb }: { href: string; title: string; blurb: string }) {
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-border hover:border-border-hover p-4 transition-colors"
    >
      <div className="font-medium text-sm group-hover:text-accent transition-colors">{title}</div>
      <div className="mt-1 text-sm text-text-secondary leading-relaxed">{blurb}</div>
    </Link>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen">
      <SiteNav />
      <article className="px-6 pt-16 pb-12 max-w-2xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl tracking-tight">Documentation</h1>
        <p className="mt-4 text-text-secondary text-lg leading-relaxed">
          Counted is privacy-first product analytics — no cookies, no fingerprinting, no PII. Get a
          key, send an event, read it on a dashboard. Here&apos;s the whole loop.
        </p>

        <H2>1. Get a project key</H2>
        <p className="mt-3 text-sm text-text-secondary leading-relaxed">
          Create a project and copy its write-only <code className="font-mono text-text-primary">ck_</code> key — or mint
          one from your terminal, no signup:
        </p>
        <div className="mt-3">
          <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
        </div>

        <H2>2. Track an event</H2>
        <p className="mt-3 text-sm text-text-secondary leading-relaxed">
          Pick your stack. Properties are plain values — strings, numbers, booleans — and there&apos;s
          no field for a user id or email, because Counted doesn&apos;t store them.
        </p>
        <div className="mt-4">
          <CodeTabs tabs={QUICKSTART} />
        </div>

        <H2>Next</H2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NextLink href="/docs/api" title="API Reference →" blurb="Every endpoint: ingestion, projects, query, dashboards, alerts." />
          <NextLink href="/for/agents" title="Analytics for AI agents →" blurb="Native plugins for Claude Code, OpenCode, Codex, and Gemini CLI." />
          <NextLink href="/blog/counted-in-any-language" title="SDK guides →" blurb="Per-language quickstarts and the flush gotcha." />
          <NextLink href="/blog/self-host-counted-in-5-minutes" title="Self-host →" blurb="Run Counted on your own infra with Docker Compose." />
        </div>

        <p className="mt-10 text-sm text-text-tertiary">
          Prefer the machine-readable spec? It&apos;s at{" "}
          <a href="/api/v0/openapi.json" className="text-accent hover:text-accent-hover transition-colors">/api/v0/openapi.json</a>
          {" "}(OpenAPI 3.1), and an agent-friendly summary at{" "}
          <a href="/docs/llms.txt" className="text-accent hover:text-accent-hover transition-colors">/docs/llms.txt</a>.
        </p>
      </article>
      <SiteFooter />
    </div>
  );
}
