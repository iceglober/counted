import Link from "next/link";
import { CountedLogo } from "@/components/icons";
import { Check } from "lucide-react";
import { AgentPrompt } from "./agent-prompt";

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
          <Link href="/pricing" className="text-text-secondary hover:text-text-primary transition-colors">Pricing</Link>
          <Link href="https://github.com/iceglober/counted" className="text-text-secondary hover:text-text-primary transition-colors">GitHub</Link>
          <Link href="/login" className="text-accent hover:text-accent-hover transition-colors font-medium">Sign in</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-24 pb-16 max-w-3xl mx-auto text-center">
        <h1 className="font-display text-4xl md:text-5xl tracking-tight leading-tight">
          Privacy-first analytics
          <br />
          <span className="text-accent">for apps that respect users</span>
        </h1>
        <p className="mt-6 text-text-secondary text-lg max-w-xl mx-auto leading-relaxed">
          Lightweight, no-cookie event tracking with composable dashboards — under 3KB,
          no PII. Or skip setup entirely and hand the prompt below to your coding agent.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/login"
            className="px-6 py-2.5 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            Start free
          </Link>
          <Link
            href="/pricing"
            className="px-6 py-2.5 border border-border text-text-secondary rounded-md text-sm hover:border-border-hover hover:text-text-primary transition-colors"
          >
            View pricing
          </Link>
        </div>
        <p className="mt-4 text-xs text-text-tertiary">100K events/month free. No credit card required.</p>
      </section>

      {/* Give this to your agent — the differentiated, agent-native path (dominant) */}
      <AgentPrompt />

      {/* Or wire it up yourself — secondary, deliberately muted */}
      <section className="px-6 max-w-2xl mx-auto pb-20">
        <p className="text-center text-xs text-text-tertiary mb-3">Or wire it up yourself in 3 lines</p>
        <pre className="bg-surface-1 border border-border rounded-lg px-6 py-5 text-sm font-mono text-text-secondary overflow-x-auto">
          <span className="text-accent">import</span>{" { Analytics } "}
          <span className="text-accent">from</span>
          {" \"@counted/sdk\";\n"}
          <span className="text-accent">const</span>
          {" analytics = "}
          <span className="text-accent">new</span>
          {" Analytics({ projectKey: \"ck_...\" });\n"}
          {"analytics.track(\"page_view\", { path: \"/\" });"}
        </pre>
      </section>

      {/* Value props */}
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

      {/* Free tier callout */}
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
              className="px-6 py-2.5 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-border">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-xs text-text-tertiary">
          <div className="flex items-center gap-2">
            <CountedLogo className="w-3.5 h-3.5" />
            <span>Counted</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="hover:text-text-secondary transition-colors">Pricing</Link>
            <a href="https://github.com/iceglober/counted" className="hover:text-text-secondary transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
