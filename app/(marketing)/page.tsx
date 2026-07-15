import Link from "next/link";
import { LandingCTA } from "./landing-cta";
import { SiteNav, SiteFooter } from "./site-chrome";
import { Hero } from "./hero";
import { TrackedCTA } from "./track";

export default function Home() {
  return (
    <div>
      <SiteNav />

      <div className="page">
        <Hero />

        <hr />

        <LandingCTA />

        <hr />

        <h2>Why Counted</h2>
        <ul>
          <li>
            <b>Privacy by design.</b>{" "}No cookies, no IP storage, no fingerprinting. GDPR- and
            CCPA-friendly, no consent banner. The code is open source.
          </li>
          <li>
            <b>Composable dashboards.</b>{" "}Breakdowns, time series, counts, funnels — mix them
            on one board, rearrange anytime.
          </li>
          <li>
            <b>Lightweight SDK.</b>{" "}Under 3KB gzipped. Vanilla JS and React packages. Tracks
            events, not users. Session IDs are ephemeral and in-memory only.
          </li>
          <li>
            <b>Agent-native too.</b>{" "}The same SDK instruments your AI coding agents — Claude
            Code, OpenCode, Codex, Gemini CLI — into a pre-built eval dashboard.{" "}
            <Link href="/for/agents">See agent analytics &raquo;</Link>
          </li>
        </ul>

        <h2>Free tier</h2>
        <p>No credit card.</p>
        <ul>
          <li>100K events/month</li>
          <li>3 projects</li>
          <li>6-month retention</li>
          <li>Composable dashboards</li>
          <li>Breakdowns, time series &amp; counts</li>
          <li>Community support</li>
        </ul>
        <p>
          <TrackedCTA href="/login" location="homepage_free_tier" label="get_started">
            Get started
          </TrackedCTA>
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}
