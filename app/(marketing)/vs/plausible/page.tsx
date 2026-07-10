import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "../../site-chrome";
import { TrackedCTA } from "../../track";

export const metadata: Metadata = {
  title: "Counted vs Plausible — privacy-first product analytics, not just pageviews",
  description:
    "Plausible is excellent privacy-first web analytics. Counted is privacy-first product analytics: same no-cookie stance, plus a free tier, funnels, and composable dashboards.",
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
  { label: "Funnels", counted: "Included (free)", plausible: "Business tier only" },
  { label: "Composable dashboards", counted: true, plausible: "Fixed dashboard" },
  { label: "Agent-native SDKs (Claude Code, OpenCode)", counted: true, plausible: false },
  { label: "SDKs", counted: "JS/TS + React (more soon)", plausible: "Script tag + integrations" },
  { label: "Focus", counted: "Product analytics (events, funnels)", plausible: "Web analytics (pageviews)" },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <>Yes</>;
  if (value === false) return <>&mdash;</>;
  return <>{value}</>;
}

export default function VsPlausiblePage() {
  return (
    <div>
      <SiteNav />

      <div className="page">
        <h1>Counted vs Plausible</h1>
        <p>
          Plausible is excellent, privacy-first web analytics — no cookies, no banner,
          beautifully simple. Counted shares that stance but goes further into product
          analytics: a free tier, funnels included, composable dashboards you build yourself,
          and native SDKs for AI coding agents.
        </p>
        <p>
          <TrackedCTA href="/login" location="vs_plausible" label="start_free">
            Start free
          </TrackedCTA>{" "}
          &nbsp;or&nbsp; <a href="#who">which fits you</a>
        </p>

        <table>
          <thead>
            <tr>
              <th style={{ width: "50%" }}>Feature</th>
              <th className="c">Counted</th>
              <th className="c">Plausible</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="c"><Cell value={row.counted} /></td>
                <td className="c"><Cell value={row.plausible} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Comparison reflects publicly documented details at the time of writing. Plausible is a
          great, privacy-first tool — verify current specifics on their site.
        </p>

        <h2 id="who">Which one fits</h2>
        <p>
          <b>Use Plausible if</b>{" "}you mainly want clean, privacy-first <em>web</em> analytics —
          traffic, sources, top pages — with the simplest possible setup.
        </p>
        <p>
          <b>Use Counted if</b>{" "}you want privacy-first <em>product</em> analytics: custom
          events, funnels (free, even self-hosted), dashboards you compose yourself, polyglot
          SDKs, and native instrumentation for AI coding agents — all with the same no-cookie,
          no-PII stance.
        </p>
        <p>
          <TrackedCTA href="/login" location="vs_plausible" label="start_free_who">
            Start free
          </TrackedCTA>
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}
