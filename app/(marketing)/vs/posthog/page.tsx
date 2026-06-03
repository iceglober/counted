import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { Reveal } from "../../reveal";
import { SiteNav, SiteFooter, Eyebrow, SecondaryCTA } from "../../site-chrome";
import { TrackedCTA } from "../../track";

export const metadata: Metadata = {
  title: "Counted vs PostHog — lightweight, privacy-first product analytics",
  description:
    "PostHog is a powerful all-in-one platform. Counted is focused product analytics: under 3KB, private by default, agent-native — without the weight or config. An honest comparison.",
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
  { label: "Funnels & retention", counted: true, posthog: true },
  { label: "Agent-native SDKs (Claude Code, OpenCode)", counted: true, posthog: false },
  { label: "Web SDK size", counted: "Under 3KB", posthog: "Much larger (full platform)" },
  { label: "Scope", counted: "Focused product analytics", posthog: "All-in-one (replay, flags, experiments, CDP…)" },
  { label: "Self-host", counted: "Docker one-liner", posthog: "Self-host (large stack)" },
  { label: "Free tier events / month", counted: "100K", posthog: "1M" },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="w-4 h-4 text-accent mx-auto" aria-label="Yes" />;
  if (value === false) return <Minus className="w-4 h-4 text-text-tertiary mx-auto" aria-label="No" />;
  return <span className="text-sm text-text-secondary">{value}</span>;
}

export default function VsPosthogPage() {
  return (
    <div className="min-h-screen">
      <SiteNav />

      <section className="px-6 pt-20 pb-10 max-w-3xl mx-auto text-center">
        <Eyebrow>Counted vs PostHog</Eyebrow>
        <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] tracking-tight leading-tight">
          PostHog does everything.
          <br />
          <span className="text-accent">Counted does analytics — light and private.</span>
        </h1>
        <p className="mt-6 text-text-secondary text-lg max-w-xl mx-auto leading-relaxed">
          PostHog is a genuinely powerful all-in-one platform — analytics, session replay, feature
          flags, experiments, and more. If you want all of that, use it. Counted is the opposite
          bet: just product analytics, under 3KB, private by default, and agent-native — without
          the weight or the config.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <TrackedCTA href="/login" location="vs_posthog" label="start_free">Start free</TrackedCTA>
          <SecondaryCTA href="#who">Which fits you</SecondaryCTA>
        </div>
      </section>

      <Reveal>
        <section className="px-6 py-12 border-t border-border">
          <div className="max-w-3xl mx-auto">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-1">
                    <th className="text-left font-medium text-text-secondary px-4 py-3 w-1/2">Feature</th>
                    <th className="font-display text-text-primary px-4 py-3">Counted</th>
                    <th className="font-medium text-text-secondary px-4 py-3">PostHog</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <td className="text-left text-text-secondary px-4 py-3">{row.label}</td>
                      <td className="text-center px-4 py-3"><Cell value={row.counted} /></td>
                      <td className="text-center px-4 py-3"><Cell value={row.posthog} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-text-tertiary">
              Comparison reflects publicly documented details at the time of writing. PostHog is a
              powerful open-source platform with a generous free tier — verify current specifics on
              their site.
            </p>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section id="who" className="px-6 py-16 border-t border-border scroll-mt-20">
          <div className="max-w-2xl mx-auto">
            <Eyebrow>Which one fits</Eyebrow>
            <h2 className="mt-2 font-display text-2xl md:text-3xl tracking-tight">Be honest with yourself</h2>
            <p className="mt-6 text-sm text-text-secondary leading-relaxed">
              <span className="text-text-primary font-medium">Use PostHog if</span> you want one tool
              for analytics <em>and</em>{" "}session replay, feature flags, experiments, surveys, and a
              data warehouse — and you&apos;re fine with a heavier SDK and more configuration.
            </p>
            <p className="mt-4 text-sm text-text-secondary leading-relaxed">
              <span className="text-text-primary font-medium">Use Counted if</span> you want focused
              product analytics that&apos;s private by default (no cookies, no fingerprinting, no PII
              out of the box), ships in under 3KB gzipped, self-hosts with Docker Compose, and natively
              instruments AI coding agents. No platform to learn — just events and composable
              dashboards.
            </p>
            <div className="mt-8">
              <TrackedCTA href="/login" location="vs_posthog" label="start_free_who">Start free</TrackedCTA>
            </div>
          </div>
        </section>
      </Reveal>

      <SiteFooter />
    </div>
  );
}
