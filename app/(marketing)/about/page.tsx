import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "../site-chrome";

export const metadata: Metadata = {
  title: "About — Counted",
  description:
    "Counted is privacy-first product analytics built by Iceglobe Enterprises LLC. What it is, who makes it, and the bet behind it.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div>
      <SiteNav />
      <div className="page">
        <h1>About Counted</h1>
        <p>
          Counted is privacy-first product analytics. It captures custom events,
          funnels, and composable dashboards — with no cookies, no fingerprinting,
          and no PII. Sessions are ephemeral: a session id lives in memory for a
          visit and is never written to a cookie, to localStorage, or to disk. That
          makes Counted GDPR- and CCPA-friendly with no consent banner, and it means
          there is no profile database to breach.
        </p>
        <p>
          It is built by <b>Iceglobe Enterprises LLC</b>, a US company, and is open
          source — you can read the code and self-host it with Docker Compose. The
          SDK is under 3KB gzipped and ships for JS/TS and React, with native plugins
          that turn AI coding agents (Claude Code, OpenCode) into a pre-built eval
          dashboard.
        </p>
        <p>
          The bet: most analytics collects far more than it needs to, and collecting
          less makes the product better. Counted is what product analytics looks like
          when you start from privacy instead of bolting it on — the same event model
          for your users and your agents, no surveillance required.
        </p>
        <h2>More</h2>
        <p>
          <a href="/docs">Docs</a> · <a href="/vs">Compare</a> ·{" "}
          <a href="/pricing">Pricing</a> · <a href="/contact">Contact</a> ·{" "}
          <a href="https://github.com/iceglober/counted" target="_blank" rel="noopener" className="ext">GitHub</a>
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}
