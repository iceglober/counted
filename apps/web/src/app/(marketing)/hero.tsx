import { TrackedCTA } from "./track";

export function Hero() {
  return (
    <div>
      <h1>Privacy-first product analytics</h1>
      <p>
        Funnels and composable dashboards. No cookies, no PII, under 3KB gzipped. Open
        source, self-hostable. The same SDK instruments your AI coding agents.
      </p>
      <p>
        <TrackedCTA href="/login" location="homepage_hero" label="start_free">
          Start free
        </TrackedCTA>{" "}
        &nbsp;or&nbsp; <a href="/pricing">view pricing</a>
      </p>
      <p className="small muted">100K events/month free. No credit card.</p>
    </div>
  );
}
