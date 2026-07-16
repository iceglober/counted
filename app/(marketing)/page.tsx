import type { Metadata } from "next";
import Link from "next/link";
import { LandingCTA } from "./landing-cta";
import { SiteNav, SiteFooter } from "./site-chrome";
import { Hero } from "./hero";
import { TrackedCTA } from "./track";
import { JsonLd, serviceLd, faqPageLd, breadcrumbLd } from "@/components/json-ld";
import { AgentView } from "./agent-view";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    types: { "text/markdown": "/index.md" },
  },
};

const HOMEPAGE_FAQ = [
  {
    q: "What is Counted?",
    a: "Counted is privacy-first product analytics — custom events, funnels, and composable dashboards with no cookies, no fingerprinting, and no PII. The same SDK also instruments AI coding agents.",
  },
  {
    q: "Does Counted use cookies?",
    a: "No. Sessions are ephemeral (in-memory, ~30 minutes) and never written to a cookie or storage, so Counted is GDPR/CCPA-friendly with no consent banner.",
  },
  {
    q: "How much does Counted cost?",
    a: "Free for 100,000 events/month with no credit card; Pro is $12/month for 1,000,000 events. It's open source and self-hostable.",
  },
  {
    q: "Can an agent use Counted without a signup?",
    a: "Yes. POST https://app.counted.dev/api/v0/provision returns a write-only client key and a claim link with no human in the loop.",
  },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  if (mode === "agent") return <AgentView />;

  return (
    <div>
      <JsonLd data={serviceLd} />
      <JsonLd data={faqPageLd(HOMEPAGE_FAQ.map((f) => ({ q: f.q, a: f.a })))} />
      <JsonLd data={breadcrumbLd([{ name: "Counted", url: "https://counted.dev" }])} />
      <SiteNav />

      <div className="page">
        <Hero />

        <hr />

        <LandingCTA />

        <hr />

        <h2>Why Counted</h2>
        <ul>
          <li>
            <b>Privacy by design.</b>{" "}No cookies, no IP storage, no fingerprinting. GDPR- and
            CCPA-friendly, no consent banner. The code is open source.
          </li>
          <li>
            <b>Composable dashboards.</b>{" "}Breakdowns, time series, counts, funnels — mix them
            on one board, rearrange anytime.
          </li>
          <li>
            <b>Lightweight SDK.</b>{" "}Under 3KB gzipped. Vanilla JS and React packages. Tracks
            events, not users. Session IDs are ephemeral and in-memory only.
          </li>
          <li>
            <b>Agent-native too.</b>{" "}The same SDK instruments your AI coding agents — Claude
            Code, OpenCode, Codex, Gemini CLI — into a pre-built eval dashboard.{" "}
            <Link href="/for/agents">See agent analytics &raquo;</Link>
          </li>
        </ul>

        <h2>Free tier</h2>
        <p>No credit card.</p>
        <ul>
          <li>100K events/month</li>
          <li>3 projects</li>
          <li>6-month retention</li>
          <li>Composable dashboards</li>
          <li>Breakdowns, time series, counts &amp; funnels</li>
          <li>Community support</li>
        </ul>
        <p>
          <TrackedCTA href="/login" location="homepage_free_tier" label="get_started">
            Get started
          </TrackedCTA>
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}
