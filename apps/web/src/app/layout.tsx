import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE_URL } from "@/lib/urls";
import "./globals.css";

/**
 * Site-wide metadata.
 *
 * This was a bare `{ title, description }`, which meant the live site shipped
 * no Open Graph or Twitter tags at all — every launch channel in the plan
 * (Show HN, Reddit, X) renders its link preview from exactly those, so a
 * shared link showed a bare URL.
 *
 * `metadataBase` is what makes the relative URLs above resolve to absolute
 * ones; without it Next emits relative OG urls, which crawlers ignore. It
 * reads `SITE_URL` so a preview deployment describes itself rather than
 * advertising production.
 *
 * `title.template` lets a page set its own title without repeating the brand;
 * `default` is what the homepage and anything else that sets none will use.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Counted — Privacy-first product analytics",
    template: "%s — Counted",
  },
  description:
    "Privacy-first product analytics with funnels and composable dashboards. " +
    "No cookies, no fingerprinting, no PII. Under 3KB gzipped.",
  openGraph: {
    type: "website",
    siteName: "Counted",
    url: SITE_URL,
    title: "Counted — Privacy-first product analytics",
    description:
      "Funnels and composable dashboards, no cookies, no consent banner, " +
      "self-host with Docker Compose. Under 3KB gzipped.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Counted — Privacy-first product analytics",
    description:
      "Funnels and composable dashboards, no cookies, no consent banner, " +
      "self-host with Docker Compose. Under 3KB gzipped.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/*
        `retro` is not decoration — it is the hook the entire stylesheet hangs
        off. Every rule in retro.css is scoped under it (`.retro a`,
        `.retro .btn`, `.retro .page`, and the base font and background on
        `.retro` itself), so a bare <body> ships the CSS and applies none of
        it: buttons render as plain text, links as browser defaults, and the
        680px `.page` column collapses to full width.

        That is exactly what production looked like. The stylesheet was in the
        bundle and the markup already said `class="btn"`; only this one class
        was missing to connect them.
      */}
      <body className="retro">{children}</body>
    </html>
  );
}
