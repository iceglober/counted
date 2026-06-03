import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { Reveal } from "../../reveal";
import { SiteNav, SiteFooter, Eyebrow, SecondaryCTA } from "../../site-chrome";
import { TrackedCTA } from "../../track";

export const metadata: Metadata = {
  title: "Counted vs Plausible — privacy-first product analytics, not just pageviews",
  description:
    "Plausible is excellent privacy-first web analytics. Counted is privacy-first product analytics: same no-cookie stance, plus a free tier, funnels & retention, composable dashboards, and agent-native SDKs.",
  alternates: { canonical: "/vs/plausible" },
  openGraph: {
    title: "Counted vs Plausible",
    description: "Same privacy stance — from web analytics to full product analytics.",
    url: "/vs/plausible",
    type: "article",
    images: ["/og?title=Counted%20vs%20Plausible&eyebrow=Comparison"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Counted vs Plausible",
    description: "Same privacy stance — from web analytics to full product analytics.",
    images: ["/og?title=Counted%20vs%20Plausible&eyebrow=Comparison"],
  },
};

type Row = { label: string; counted: string | boolean; plausible: string | boolean };

const ROWS: Row[] = [
  { label: "No cookies, no fingerprinting", counted: true, plausible: true },
  { label: "GDPR/CCPA without a consent banner", counted: true, plausible: true },
  { label: "Self-hostable, open source", counted: true, plausible: true },
  { label: "Custom events", counted: true, plausible: true },
  { label: "Free cloud tier", counted: "100K events/mo", plausible: "No (30-day trial)" },
  { label: "Funnels & retention", counted: "Included", plausible: "Paid tier; not in self-hosted" },
  { label: "Composable dashboards", counted: true, plausible: "Fixed dashboard" },
  { label: "Agent-native SDKs (Claude Code, OpenCode)", counted: true, plausible: false },
  { label: "SDKs", counted: "JS, React, Python, Go, Rust", plausible: "Script tag + integrations" },
  { label: "Focus", counted: "Product analytics (events, funnels)", plausible: "Web analytics (pageviews)" },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="w-4 h-4 text-accent mx-auto" aria-label="Yes" />;
  if (value === false) return <Minus className="w-4 h-4 text-text-tertiary mx-auto" aria-label="No" />;
  return <span className="text-sm text-text-secondary">{value}</span>;
}

export default function VsPlausiblePage() {
  return (
    <div className="min-h-screen">
      <SiteNav />

      <section className="px-6 pt-20 pb-10 max-w-3xl mx-auto text-center">
        <Eyebrow>Counted vs Plausible</Eyebrow>
        <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] tracking-tight leading-tight">
          Same privacy stance.
          <br />
          <span className="text-accent">From pageviews to product analytics.</span>
        </h1>
        <p className="mt-6 text-text-secondary text-lg max-w-xl mx-auto leading-relaxed">
          Plausible is excellent, privacy-first web analytics — no cookies, no banner, beautifully
          simple. Counted shares that stance but goes further into product analytics: a free tier,
          funnels and retention included, composable dashboards you build yourself, and native SDKs
          for AI coding agents.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <TrackedCTA href="/login" location="vs_plausible" label="start_free">Start free</TrackedCTA>
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
                    <th className="font-medium text-text-secondary px-4 py-3">Plausible</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <td className="text-left text-text-secondary px-4 py-3">{row.label}</td>
                      <td className="text-center px-4 py-3"><Cell value={row.counted} /></td>
                      <td className="text-center px-4 py-3"><Cell value={row.plausible} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-text-tertiary">
              Comparison reflects publicly documented details at the time of writing. Plausible is a
              great, privacy-first tool — verify current specifics on their site.
            </p>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section id="who" className="px-6 py-16 border-t border-border scroll-mt-20">
          <div className="max-w-2xl mx-auto">
            <Eyebrow>Which one fits</Eyebrow>
            <h2 className="mt-2 font-display text-2xl md:text-3xl tracking-tight">Pick by what you measure</h2>
            <p className="mt-6 text-sm text-text-secondary leading-relaxed">
              <span className="text-text-primary font-medium">Use Plausible if</span> you mainly want
              clean, privacy-first <em>web</em> analytics — traffic, sources, top pages — with the
              simplest possible setup.
            </p>
            <p className="mt-4 text-sm text-text-secondary leading-relaxed">
              <span className="text-text-primary font-medium">Use Counted if</span> you want privacy-first{" "}
              <em>product</em> analytics: custom events, funnels and retention (free, even
              self-hosted), dashboards you compose yourself, polyglot SDKs, and native instrumentation
              for AI coding agents — all with the same no-cookie, no-PII stance.
            </p>
            <div className="mt-8">
              <TrackedCTA href="/login" location="vs_plausible" label="start_free_who">Start free</TrackedCTA>
            </div>
          </div>
        </section>
      </Reveal>

      <SiteFooter />
    </div>
  );
}
