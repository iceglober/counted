import Link from "next/link";
import { CountedLogo } from "@/components/icons";
import { Check } from "lucide-react";
import { LandingCTA } from "./landing-cta";
import { Reveal } from "./reveal";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <CountedLogo className="w-5 h-5 text-accent" />
          <span className="font-display text-lg tracking-wide">Counted</span>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <Link href="/blog" className="text-text-secondary hover:text-text-primary transition-colors">Blog</Link>
          <Link href="/pricing" className="text-text-secondary hover:text-text-primary transition-colors">Pricing</Link>
          <Link href="https://github.com/iceglober/counted" className="text-text-secondary hover:text-text-primary transition-colors">GitHub</Link>
          <Link href="/login" className="text-accent hover:text-accent-hover transition-colors font-medium">Sign in</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-24 pb-16 max-w-3xl mx-auto text-center">
        <h1 className="animate-rise font-display text-[clamp(2.25rem,5.5vw,3.25rem)] tracking-tight leading-tight">
          Privacy-first analytics
          <br />
          <span className="text-accent">for products that respect users</span>
        </h1>
        <p className="animate-rise mt-6 text-text-secondary text-lg max-w-xl mx-auto leading-relaxed" style={{ animationDelay: "90ms" }}>
          Lightweight, no-cookie event tracking with composable dashboards.
          No fingerprinting. No PII. Under 3KB.
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
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-sm font-medium mb-2">Privacy by design</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              No cookies, no IP storage, no fingerprinting. GDPR-compliant without a consent banner.
              Users can verify the claim — the code is open source.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Composable dashboards</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              Build your own view. Add insights for any metric — breakdowns, time series, counts.
              Every insight runs its own query. Rearrange anytime.
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
          <h2 className="text-2xl font-display tracking-tight">Generous free tier</h2>
          <p className="mt-4 text-text-secondary">
            100,000 events per month. 3 projects. 6-month data retention. No credit card.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-text-secondary inline-block text-left">
            {[
              "100K events/month",
              "3 projects",
              "6-month retention",
              "Composable dashboards",
              "All insight types",
              "Open source SDK",
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
              <Link href="/vs/aptabase" className="hover:text-text-secondary transition-colors">Compare</Link>
              <a href="https://github.com/iceglober/counted" className="hover:text-text-secondary transition-colors">GitHub</a>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-text-tertiary/80">
            <span>No cookies. No fingerprinting. No PII.</span>
            <span>© {new Date().getFullYear()} Iceglobe Enterprises LLC</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
