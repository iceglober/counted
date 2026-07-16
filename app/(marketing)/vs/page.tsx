import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav, SiteFooter } from "../site-chrome";

export const metadata: Metadata = {
  title: "Compare Counted — vs Aptabase, PostHog, Plausible",
  description:
    "Counted vs Aptabase, PostHog, and Plausible. Privacy-first, under 3KB gzipped, funnels and composable dashboards.",
  alternates: { canonical: "/vs" },
  openGraph: {
    title: "Compare Counted",
    description: "Side-by-sides vs Aptabase, PostHog, and Plausible.",
    url: "/vs",
    type: "website",
    images: ["/og?title=Compare%20Counted&eyebrow=Comparisons"],
  },
};

const COMPARISONS = [
  {
    href: "/vs/aptabase",
    name: "Counted vs Aptabase",
    blurb:
      "Same privacy stance, plus composable dashboards, funnels, a larger free tier, and a migration CLI.",
  },
  {
    href: "/vs/posthog",
    name: "Counted vs PostHog",
    blurb:
      "Lightweight, private-by-default product analytics vs the all-in-one platform. Under 3KB gzipped, focused, no config.",
  },
  {
    href: "/vs/plausible",
    name: "Counted vs Plausible",
    blurb:
      "Same no-cookie stance, but product analytics: funnels and composable dashboards.",
  },
  {
    href: "/vs/counter",
    name: "Counted vs Counter.dev",
    blurb:
      "Both privacy-first, one letter apart. counter.dev counts visits; Counted does product analytics — events, funnels, dashboards.",
  },
];

export default function ComparePage() {
  return (
    <div>
      <SiteNav />

      <div className="page">
        <h1>How Counted compares</h1>
        <p>Side-by-sides, including where the other tool wins.</p>

        <ul>
          {COMPARISONS.map((c) => (
            <li key={c.href}>
              <Link href={c.href}>
                <b>{c.name}</b>
              </Link>
              <br />
              {c.blurb}
            </li>
          ))}
        </ul>
      </div>

      <SiteFooter />
    </div>
  );
}
