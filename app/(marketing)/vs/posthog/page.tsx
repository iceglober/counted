import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "../../site-chrome";
import { TrackedCTA } from "../../track";

export const metadata: Metadata = {
  title: "Counted vs PostHog — lightweight, privacy-first product analytics",
  description:
    "PostHog is an all-in-one platform. Counted is focused product analytics: under 3KB gzipped, private by default, funnels and composable dashboards.",
  alternates: { canonical: "/vs/posthog" },
  openGraph: {
    title: "Counted vs PostHog",
    description: "Lightweight, private-by-default product analytics vs the all-in-one platform.",
    url: "/vs/posthog",
    type: "article",
    images: ["/og?title=Counted%20vs%20PostHog&eyebrow=Comparison"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Counted vs PostHog",
    description: "Lightweight, private-by-default product analytics vs the all-in-one platform.",
    images: ["/og?title=Counted%20vs%20PostHog&eyebrow=Comparison"],
  },
};

type Row = { label: string; counted: string | boolean; posthog: string | boolean };

const ROWS: Row[] = [
  { label: "Cookieless / no fingerprinting by default", counted: true, posthog: "Optional (configure)" },
  { label: "No PII collected by design", counted: true, posthog: "Configurable" },
  { label: "GDPR/CCPA without a consent banner", counted: true, posthog: "Possible (cookieless mode)" },
  { label: "Composable dashboards", counted: true, posthog: true },
  { label: "Funnels", counted: true, posthog: true },
  { label: "Agent-native SDKs (Claude Code, OpenCode)", counted: true, posthog: false },
  { label: "Web SDK size", counted: "<3KB gzipped", posthog: "Much larger (full platform)" },
  { label: "Scope", counted: "Focused product analytics", posthog: "All-in-one (replay, flags, experiments, CDP…)" },
  { label: "Self-host", counted: "Docker Compose", posthog: "Self-host (large stack)" },
  { label: "Free tier events / month", counted: "100K", posthog: "1M" },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <>Yes</>;
  if (value === false) return <>&mdash;</>;
  return <>{value}</>;
}

export default function VsPosthogPage() {
  return (
    <div>
      <SiteNav />

      <div className="page">
        <h1>Counted vs PostHog</h1>
        <p>
          PostHog is an all-in-one platform — analytics, session replay, feature flags,
          experiments. If you want all of that, use it. Counted is just product analytics:
          under 3KB gzipped, private by default, funnels and composable dashboards.
        </p>
        <p>
          <TrackedCTA href="/login" location="vs_posthog" label="start_free">
            Start free
          </TrackedCTA>{" "}
          &nbsp;or&nbsp; <a href="#who">which fits you</a>
        </p>

        <table>
          <thead>
            <tr>
              <th style={{ width: "50%" }}>Feature</th>
              <th className="c">Counted</th>
              <th className="c">PostHog</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="c"><Cell value={row.counted} /></td>
                <td className="c"><Cell value={row.posthog} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Based on public docs at the time of writing. Check PostHog&apos;s site for current
          specifics.
        </p>

        <h2 id="who">Which one fits</h2>
        <p>
          <b>Use PostHog if</b>{" "}you want one tool for analytics <em>and</em> session replay,
          feature flags, experiments, surveys, and a data warehouse — and don&apos;t mind a
          heavier SDK and more config.
        </p>
        <p>
          <b>Use Counted if</b>{" "}you want product analytics that&apos;s private by default
          (no cookies, no fingerprinting, no PII), under 3KB gzipped, self-hosts with Docker
          Compose, and natively instruments AI coding agents. Just events and composable
          dashboards.
        </p>
        <p>
          <TrackedCTA href="/login" location="vs_posthog" label="start_free_who">
            Start free
          </TrackedCTA>
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}
