import { TrackedCTA } from "./track";

// Homepage hero. Was a two-variant A/B test (control vs "depth" framing) —
// collapsed to the control copy once the experiment stopped being read; the
// framing matches the decided positioning (privacy-first lead, depth as proof).
export function Hero() {
  return (
    <section className="px-6 pt-24 pb-16 max-w-3xl mx-auto text-center">
      <h1 className="animate-rise font-display text-[clamp(2.25rem,5.5vw,3.25rem)] tracking-tight leading-tight">
        Privacy-first product analytics
        <br />
        <span className="text-accent">without the bloat or the banner</span>
      </h1>
      <p className="animate-rise mt-6 text-text-secondary text-lg max-w-xl mx-auto leading-relaxed" style={{ animationDelay: "90ms" }}>
        Funnels and composable dashboards, no cookies, no PII, under 3KB gzipped.
      </p>
      <div className="animate-rise mt-8 flex items-center justify-center gap-4" style={{ animationDelay: "180ms" }}>
        <TrackedCTA href="/login" location="homepage_hero" label="start_free" variant="primary">
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
