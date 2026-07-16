import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "../../site-chrome";
import { TrackedCTA } from "../../track";
import { JsonLd, faqPageLd } from "@/components/json-ld";

export const metadata: Metadata = {
  title: "Counted vs Counter.dev — product analytics vs a visitor counter",
  description:
    "Counted and counter.dev are both privacy-first and cookie-free. counter.dev counts visits; Counted does product analytics — custom events, funnels, and composable dashboards. An honest comparison.",
  alternates: { canonical: "/vs/counter" },
  openGraph: {
    title: "Counted vs Counter.dev",
    description: "Both privacy-first. counter.dev counts visits; Counted does product analytics — events, funnels, dashboards.",
    url: "/vs/counter",
    type: "article",
    images: ["/og?title=Counted%20vs%20Counter.dev&eyebrow=Comparison"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Counted vs Counter.dev",
    description: "Both privacy-first. counter.dev counts visits; Counted does product analytics.",
    images: ["/og?title=Counted%20vs%20Counter.dev&eyebrow=Comparison"],
  },
};

type Row = { label: string; counted: string | boolean; counter: string | boolean };

const ROWS: Row[] = [
  { label: "No cookies, no fingerprinting", counted: true, counter: true },
  { label: "GDPR/CCPA without a consent banner", counted: true, counter: true },
  { label: "Open source", counted: true, counter: "Yes (AGPL)" },
  { label: "Self-host", counted: "Docker Compose", counter: "Yes (Go + Redis)" },
  { label: "What it tracks", counted: "Custom events", counter: "Pageviews (first view)" },
  { label: "Custom events", counted: true, counter: false },
  { label: "Funnels", counted: true, counter: false },
  { label: "Composable dashboards", counted: true, counter: "Fixed dashboard" },
  { label: "Agent-native SDKs (Claude Code, OpenCode)", counted: true, counter: false },
  { label: "Free tier", counted: "100K events/mo", counter: "Pay-what-you-want" },
  { label: "Focus", counted: "Product analytics", counter: "Minimal visitor counter" },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <>Yes</>;
  if (value === false) return <>&mdash;</>;
  return <>{value}</>;
}

const FAQ = [
  {
    q: "Is Counted the same as counter.dev?",
    a: "No. They're different products by different people, one letter apart. counter.dev is a minimal, privacy-friendly visitor counter — daily uniques, referrers, and where your traffic comes from. Counted is product analytics: custom events, funnels, and dashboards you build. Both are cookie-free and open source.",
  },
  {
    q: "Which should I use?",
    a: "If you want a lightweight pageview counter, use counter.dev — it's good at that. If you're measuring what happens inside your product (signups, feature use, funnels) or instrumenting AI coding agents, use Counted.",
  },
];

export default function VsCounterPage() {
  return (
    <div>
      <JsonLd data={faqPageLd(FAQ)} />
      <SiteNav />

      <div className="page">
        <h1>Counted vs Counter.dev</h1>
        <p>
          Two privacy-first tools, one letter apart, by different people. Both skip cookies,
          fingerprinting, and PII. The difference is what they measure:{" "}
          <b>counter.dev counts visits</b> — daily uniques, referrers, where your traffic comes
          from. <b>Counted does product analytics</b> — custom events, funnels, and dashboards
          you build, plus the same SDK for your AI coding agents.
        </p>
        <p>
          <TrackedCTA href="/login" location="vs_counter" label="start_free">
            Start free
          </TrackedCTA>{" "}
          &nbsp;or&nbsp; <a href="#which">which fits you</a>
        </p>

        <table>
          <thead>
            <tr>
              <th style={{ width: "42%" }}>Feature</th>
              <th className="c">Counted</th>
              <th className="c">Counter.dev</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="c"><Cell value={row.counted} /></td>
                <td className="c"><Cell value={row.counter} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Based on counter.dev&apos;s public docs at the time of writing. counter.dev is a good
          minimal counter — check their site for current details.
        </p>

        <h2 id="which">Which one fits</h2>
        <p>
          <b>Use counter.dev if</b> you want a simple, privacy-friendly pageview counter: how many
          people visited, and where they came from. It&apos;s lightweight and does that well.
        </p>
        <p>
          <b>Use Counted if</b> you need to measure what happens inside your product — custom
          events, funnels, feature use — on dashboards you compose yourself, or you want to
          instrument AI coding agents. Same privacy stance, more to build with.
        </p>
        <p>
          <TrackedCTA href="/login" location="vs_counter" label="start_free_which">
            Start free
          </TrackedCTA>
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}
