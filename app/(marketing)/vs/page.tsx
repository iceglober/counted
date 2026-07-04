import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav, SiteFooter } from "../site-chrome";

export const metadata: Metadata = {
  title: "Compare Counted — vs Aptabase, PostHog, Plausible",
  description:
    "How Counted compares to other analytics tools. Privacy-first, under 3KB gzipped, funnels and composable dashboards — see the honest side-by-sides.",
  alternates: { canonical: "/vs" },
  openGraph: {
    title: "Compare Counted",
    description: "Honest side-by-sides vs Aptabase, PostHog, and Plausible.",
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
      "Same privacy stance, more to build with — composable dashboards, funnels, a larger free tier, and a migration CLI.",
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
      "The same no-cookie stance — but from web analytics to full product analytics: funnels and composable dashboards.",
  },
];

export default function ComparePage() {
  return (
    <div>
      <SiteNav />

      <div className="page">
        <h1>How Counted compares</h1>
        <p>Honest side-by-sides — including where the other tool is the better fit.</p>

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
