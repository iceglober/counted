import type { Metadata } from "next";
import Link from "next/link";
import { CountedLogo } from "@/components/icons";
import { Check } from "lucide-react";
import { SiteNav } from "../site-chrome";

export const metadata: Metadata = {
  title: "Pricing — Counted",
  description:
    "Counted pricing: a free tier with 100K events/month and no credit card, and Pro at $12/month for 1M events. Self-host any plan.",
  alternates: { canonical: "/pricing" },
};

const FREE_FEATURES = [
  "100K events/month",
  "3 projects",
  "6-month retention",
  "Composable dashboards",
  "Breakdowns, time series & counts",
  "Community support",
];

const PRO_FEATURES = [
  "1M events/month",
  "Unlimited projects",
  "24-month retention",
  "Full API access",
  "Priority support",
  "Custom accent colors",
];

export default function PricingPage() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <SiteNav />

      {/* Header */}
      <section className="px-6 pt-20 pb-12 max-w-3xl mx-auto text-center">
        <h1 className="font-display text-3xl tracking-tight">Simple pricing</h1>
        <p className="mt-3 text-text-secondary">
          Start free. Upgrade when you need more.
        </p>
      </section>

      {/* Plans */}
      <section className="px-6 pb-20 max-w-3xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Free */}
          <div className="bg-surface-1 border border-border rounded-lg p-6">
            <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider">Free</h2>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-semibold">$0</span>
              <span className="text-text-tertiary text-sm">/month</span>
            </div>
            <p className="mt-2 text-sm text-text-tertiary">For side projects and evaluation.</p>
            <ul className="mt-6 space-y-2.5">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                  <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/login"
              className="mt-8 block text-center px-4 py-2.5 border border-border text-text-secondary rounded-md text-sm hover:border-border-hover hover:text-text-primary transition-colors"
            >
              Get started
            </Link>
          </div>

          {/* Pro */}
          <div className="bg-surface-1 border border-accent/30 rounded-lg p-6 relative">
            <div className="absolute -top-3 left-6 px-2 py-0.5 bg-accent text-surface-0 text-xs font-medium rounded">
              Recommended
            </div>
            <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider">Pro</h2>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-semibold">$12</span>
              <span className="text-text-tertiary text-sm">/month</span>
            </div>
            <p className="mt-1 text-xs text-text-tertiary">or $120/year (save $24)</p>
            <p className="mt-2 text-sm text-text-tertiary">For production apps and teams.</p>
            <ul className="mt-6 space-y-2.5">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                  <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/login"
              className="mt-8 block text-center px-4 py-2.5 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              Get Pro
            </Link>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-text-tertiary">
          All plans include the full SDK and every insight type — breakdowns, time series, and counts.
          Counted is fully open source — self-host anytime. No cookies, no consent banner.
          <br />
          Need more than 1M events/month?{" "}
          <a href="mailto:austin@iceglobe.io" className="text-accent hover:text-accent-hover transition-colors">
            Let's talk
          </a>.
        </p>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-border">
        <div className="max-w-4xl mx-auto flex flex-col gap-4 text-xs text-text-tertiary">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CountedLogo className="w-3.5 h-3.5" />
              <span>Counted</span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/" className="hover:text-text-secondary transition-colors">Home</Link>
              <Link href="/blog" className="hover:text-text-secondary transition-colors">Blog</Link>
              <Link href="/vs" className="hover:text-text-secondary transition-colors">Compare</Link>
              <a href="https://github.com/iceglober/counted" className="hover:text-text-secondary transition-colors">GitHub</a>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-text-tertiary/80">
            <span>No cookies. No fingerprinting. No PII.</span>
            <span className="flex items-center gap-4">
              <Link href="/privacy" className="hover:text-text-secondary transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-text-secondary transition-colors">Terms</Link>
              <span>© {new Date().getFullYear()} Iceglobe Enterprises LLC</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
