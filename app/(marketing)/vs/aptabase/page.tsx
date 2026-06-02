import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { Reveal } from "../../reveal";
import { SiteNav, SiteFooter, Eyebrow, CodeBlock, PrimaryCTA, SecondaryCTA } from "../../site-chrome";

export const metadata: Metadata = {
  title: "Counted vs Aptabase — privacy analytics with composable dashboards",
  description:
    "A side-by-side comparison of Counted and Aptabase: composable dashboards, agent-native SDKs, a larger free tier, and a one-command migration. Both are privacy-first and cookie-free.",
  alternates: { canonical: "/vs/aptabase" },
  openGraph: {
    title: "Counted vs Aptabase",
    description:
      "Composable dashboards, agent-native SDKs, a larger free tier, and a one-command migration — without leaving privacy-first analytics.",
    url: "/vs/aptabase",
    type: "article",
  },
};

type Row = { label: string; counted: string | boolean; aptabase: string | boolean };

const ROWS: Row[] = [
  { label: "No cookies, no fingerprinting", counted: true, aptabase: true },
  { label: "GDPR/CCPA without a consent banner", counted: true, aptabase: true },
  { label: "Composable dashboards (custom insights)", counted: true, aptabase: false },
  { label: "Funnels & retention", counted: true, aptabase: false },
  { label: "Agent-native SDKs (Claude Code, OpenCode, Cursor)", counted: true, aptabase: false },
  { label: "Polyglot SDKs", counted: "JS, React, Python, Go, Rust", aptabase: "Swift, Kotlin, JS, others" },
  { label: "SDK size (web)", counted: "Under 3KB", aptabase: "~5KB" },
  { label: "Self-host", counted: "Docker one-liner", aptabase: "Self-host (manual)" },
  { label: "Free tier events / month", counted: "100K", aptabase: "20K" },
  { label: "Migration CLI", counted: "@counted/migrate", aptabase: false },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="w-4 h-4 text-accent mx-auto" aria-label="Yes" />;
  if (value === false) return <Minus className="w-4 h-4 text-text-tertiary mx-auto" aria-label="No" />;
  return <span className="text-sm text-text-secondary">{value}</span>;
}

export default function VsAptabasePage() {
  return (
    <div className="min-h-screen">
      <SiteNav />

      <section className="px-6 pt-20 pb-10 max-w-3xl mx-auto text-center">
        <Eyebrow>Counted vs Aptabase</Eyebrow>
        <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] tracking-tight leading-tight">
          Same privacy stance.
          <br />
          <span className="text-accent">More to build with.</span>
        </h1>
        <p className="mt-6 text-text-secondary text-lg max-w-xl mx-auto leading-relaxed">
          Aptabase and Counted both reject cookies, fingerprinting, and PII. Counted adds
          composable dashboards, agent-native SDKs, a larger free tier — and a one-command
          way to bring your history over.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <PrimaryCTA href="/login">Start free</PrimaryCTA>
          <SecondaryCTA href="#migrate">How to migrate</SecondaryCTA>
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
                    <th className="font-medium text-text-secondary px-4 py-3">Aptabase</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <td className="text-left text-text-secondary px-4 py-3">{row.label}</td>
                      <td className="text-center px-4 py-3"><Cell value={row.counted} /></td>
                      <td className="text-center px-4 py-3"><Cell value={row.aptabase} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-text-tertiary">
              Comparison reflects each product&apos;s publicly documented details at the time of
              writing. Aptabase is open source and a good tool — verify current limits on their site.
            </p>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section id="migrate" className="px-6 py-16 border-t border-border scroll-mt-20">
          <div className="max-w-2xl mx-auto">
            <Eyebrow>Migrate in two steps</Eyebrow>
            <h2 className="mt-2 font-display text-2xl md:text-3xl tracking-tight">Bring your history, then swap the SDK</h2>

            <p className="mt-6 text-sm text-text-secondary leading-relaxed">
              <span className="text-text-primary font-medium">1. Import your events.</span>{" "}
              Point <code className="font-mono text-text-primary">@counted/migrate</code> at your
              Aptabase Postgres (or a CSV export) and your Counted project key.
            </p>
            <div className="mt-3">
              <CodeBlock>{`npx @counted/migrate \\
  --source-db "postgres://aptabase:..." \\
  --target-key "ck_your_project_key" \\
  --target-host "https://app.counted.dev" \\
  --since "2025-01-01"`}</CodeBlock>
            </div>

            <p className="mt-8 text-sm text-text-secondary leading-relaxed">
              <span className="text-text-primary font-medium">2. Swap the SDK.</span>{" "}
              The shape is the same — initialize once, then track named events with properties.
            </p>
            <div className="mt-3 grid gap-3">
              <div>
                <p className="text-xs text-text-tertiary mb-1 font-mono">— before (Aptabase)</p>
                <CodeBlock>{`import { init, trackEvent } from "@aptabase/web";

init("A-EU-0000000000");
trackEvent("plan_selected", { plan: "premium" });`}</CodeBlock>
              </div>
              <div>
                <p className="text-xs text-accent mb-1 font-mono">+ after (Counted)</p>
                <CodeBlock>{`import { Analytics } from "@counted/sdk";

const counted = new Analytics({ projectKey: "ck_..." });
counted.track("plan_selected", { plan: "premium" });`}</CodeBlock>
              </div>
            </div>

            <div className="mt-8">
              <PrimaryCTA href="/login">Create a project &amp; migrate</PrimaryCTA>
            </div>
          </div>
        </section>
      </Reveal>

      <SiteFooter />
    </div>
  );
}
