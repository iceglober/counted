import Link from "next/link";
import { Check } from "lucide-react";
import { LandingCTA } from "./landing-cta";
import { Reveal } from "./reveal";
import { SiteNav, SiteFooter } from "./site-chrome";
import { Hero } from "./hero";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <SiteNav />

      {/* Hero — live A/B test: privacy-lead vs agent-lead (see hero.tsx) */}
      <Hero />

      {/* A/B-tested hero CTA — agent prompt / code-first / one-command / try-live */}
      <Reveal>
        <LandingCTA />
      </Reveal>

      {/* Value props */}
      <Reveal>
      <section className="px-6 py-16 border-t border-border">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <h3 className="text-sm font-medium mb-2">Privacy by design</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              No cookies, no IP storage, no fingerprinting. GDPR- and CCPA-friendly, with no consent
              banner. You don&apos;t have to take our word for it — the code is open source.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Composable dashboards</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              Build your own view. Add any insight — breakdowns, time series, counts, funnels.
              Mix metrics from different events on one board, and rearrange anytime.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Lightweight SDK</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              Under 3KB gzipped. Vanilla JS and React packages.
              Tracks events, not users. Session IDs are ephemeral and in-memory only.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Agent-native too</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              The same SDK instruments your AI coding agents — Claude Code, OpenCode, Codex, Gemini
              CLI — into a pre-built eval dashboard.{" "}
              <Link href="/for/agents" className="text-accent hover:text-accent-hover transition-colors">See agent analytics →</Link>
            </p>
          </div>
        </div>
      </section>
      </Reveal>

      {/* Free tier callout */}
      <Reveal>
      <section className="px-6 py-16 border-t border-border">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-2xl font-display tracking-tight">Free tier</h2>
          <p className="mt-4 text-text-secondary">
            Everything you need to ship — no credit card required.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-text-secondary inline-block text-left">
            {[
              "100K events/month",
              "3 projects",
              "6-month retention",
              "Composable dashboards",
              "Breakdowns, time series & counts",
              "Community support",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-6 py-3 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover active:translate-y-px transition-[background-color,transform] duration-150"
            >
              Get started
            </Link>
          </div>
        </div>
      </section>
      </Reveal>

      {/* Footer */}
      <SiteFooter />
    </div>
  );
}
