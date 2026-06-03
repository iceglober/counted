import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav, SiteFooter, Eyebrow } from "../site-chrome";

export const metadata: Metadata = {
  title: "Compare Counted — vs Aptabase, PostHog, Plausible",
  description:
    "How Counted compares to other analytics tools. Privacy-first, under 3KB, composable dashboards, agent-native — see the honest side-by-sides.",
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
    blurb: "Same privacy stance, more to build with — composable dashboards, agent-native SDKs, a larger free tier, and a one-command migration.",
  },
  {
    href: "/vs/posthog",
    name: "Counted vs PostHog",
    blurb: "Lightweight, private-by-default product analytics vs the all-in-one platform. Under 3KB, focused, no config.",
  },
  {
    href: "/vs/plausible",
    name: "Counted vs Plausible",
    blurb: "The same no-cookie stance — but from web analytics to full product analytics: funnels, composable dashboards, agent-native SDKs.",
  },
];

export default function ComparePage() {
  return (
    <div className="min-h-screen">
      <SiteNav />

      <section className="px-6 pt-20 pb-10 max-w-2xl mx-auto text-center">
        <Eyebrow>Compare</Eyebrow>
        <h1 className="mt-3 font-display text-3xl md:text-4xl tracking-tight">How Counted compares</h1>
        <p className="mt-4 text-text-secondary leading-relaxed">
          Honest side-by-sides — including where the other tool is the better fit.
        </p>
      </section>

      <section className="px-6 pb-20 max-w-2xl mx-auto">
        <div className="divide-y divide-border border-t border-border">
          {COMPARISONS.map((c) => (
            <Link key={c.href} href={c.href} className="group block py-6 transition-colors">
              <h2 className="font-display text-lg md:text-xl tracking-tight group-hover:text-accent transition-colors">
                {c.name}
              </h2>
              <p className="mt-2 text-sm text-text-secondary leading-relaxed">{c.blurb}</p>
            </Link>
          ))}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
