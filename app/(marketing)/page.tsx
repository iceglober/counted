import Link from "next/link";
import { CountedLogo } from "@/components/icons";
import { Check } from "lucide-react";
import { LandingCTA } from "./landing-cta";
import { Reveal } from "./reveal";
import { SiteNav } from "./site-chrome";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <SiteNav />

      {/* Hero */}
      <section className="px-6 pt-24 pb-16 max-w-3xl mx-auto text-center">
        <h1 className="animate-rise font-display text-[clamp(2.25rem,5.5vw,3.25rem)] tracking-tight leading-tight">
          Privacy-first analytics
          <br />
          <span className="text-accent">for products and agents</span>
        </h1>
        <p className="animate-rise mt-6 text-text-secondary text-lg max-w-xl mx-auto leading-relaxed" style={{ animationDelay: "90ms" }}>
          No-cookie analytics for your product and your AI agents. Composable
          dashboards, no fingerprinting, no PII, under 3KB gzipped.
        </p>
        <div className="animate-rise mt-8 flex items-center justify-center gap-4" style={{ animationDelay: "180ms" }}>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-6 py-3 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover active:translate-y-px transition-[background-color,transform] duration-150"
          >
            Start free
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center px-6 py-3 border border-border text-text-secondary rounded-md text-sm hover:border-border-hover hover:text-text-primary active:translate-y-px transition-[border-color,color,transform] duration-150"
          >
            View pricing
          </Link>
        </div>
        <p className="animate-rise mt-4 text-xs text-text-tertiary" style={{ animationDelay: "240ms" }}>100K events/month free. No credit card required.</p>
      </section>

      {/* A/B-tested hero CTA — agent prompt / code-first / one-command / try-live */}
      <Reveal>
        <LandingCTA />
      </Reveal>

      {/* Value props */}
      <Reveal>
      <section className="px-6 py-16 border-t border-border">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <h3 className="text-sm font-medium mb-2">Agent-native</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              See what your coding agents actually do. Native plugins for Claude Code, OpenCode,
              Codex, and Gemini CLI capture tool calls and outcomes in a pre-built eval dashboard.{" "}
              <Link href="/for/agents" className="text-accent hover:text-accent-hover transition-colors">See agent analytics →</Link>
            </p>
          </div>
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
              Build your own view. Add insights for any metric — breakdowns, time series, counts.
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
      <footer className="px-6 py-8 border-t border-border">
        <div className="max-w-4xl mx-auto flex flex-col gap-4 text-xs text-text-tertiary">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CountedLogo className="w-3.5 h-3.5" />
              <span>Counted</span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/blog" className="hover:text-text-secondary transition-colors">Blog</Link>
              <Link href="/pricing" className="hover:text-text-secondary transition-colors">Pricing</Link>
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
