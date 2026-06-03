"use client";

import { useEffect, useState } from "react";
import { assignExperiment, track } from "./analytics";
import { TrackedCTA } from "./track";

// Live A/B test of the homepage hero (privacy-lead vs agent-lead). "control" is
// the SSR default so the H1 is always in the server HTML (SEO, no empty headline)
// and only the agent-bucket swaps after hydration. Assignment + measurement run
// through the privacy-first experiment primitive in analytics.ts: exposure is the
// `experiment_view` event and intent is `cta_click`, both tagged with the variant
// (via the exp_hero super-property), so the dogfood dashboard can compare them.
const HERO_VARIANTS = ["control", "agent"] as const;
type HeroVariant = (typeof HERO_VARIANTS)[number];

export function Hero() {
  const [variant, setVariant] = useState<HeroVariant>("control");

  useEffect(() => {
    const v = assignExperiment("hero", HERO_VARIANTS);
    if (v !== "control") setVariant(v);
    track("experiment_view", { experiment: "hero", variant: v });
  }, []);

  const agent = variant === "agent";

  return (
    <section className="px-6 pt-24 pb-16 max-w-3xl mx-auto text-center">
      <h1 className="animate-rise font-display text-[clamp(2.25rem,5.5vw,3.25rem)] tracking-tight leading-tight">
        {agent ? (
          <>
            See what your AI agents do
            <br />
            <span className="text-accent">— and what your users do</span>
          </>
        ) : (
          <>
            Privacy-first analytics
            <br />
            <span className="text-accent">for products and agents</span>
          </>
        )}
      </h1>
      <p className="animate-rise mt-6 text-text-secondary text-lg max-w-xl mx-auto leading-relaxed" style={{ animationDelay: "90ms" }}>
        {agent
          ? "Privacy-first analytics for your coding agents and your product. Native plugins for Claude Code, OpenCode, Codex, and Gemini CLI. No cookies, no PII, under 3KB gzipped."
          : "No-cookie analytics for your product and your AI agents. Composable dashboards, no fingerprinting, no PII, under 3KB gzipped."}
      </p>
      <div className="animate-rise mt-8 flex items-center justify-center gap-4" style={{ animationDelay: "180ms" }}>
        <TrackedCTA href={`/login?exp_hero=${variant}`} location="homepage_hero" label="start_free" variant="primary">
          Start free
        </TrackedCTA>
        <TrackedCTA href="/pricing" location="homepage_hero" label="view_pricing" variant="secondary">
          View pricing
        </TrackedCTA>
      </div>
      <p className="animate-rise mt-4 text-xs text-text-tertiary" style={{ animationDelay: "240ms" }}>
        100K events/month free. No credit card required.
      </p>
    </section>
  );
}
