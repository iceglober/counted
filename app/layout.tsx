import type { Metadata } from "next";
import { CountedAnalytics } from "@/components/analytics";
import { JsonLd, organizationLd, websiteLd } from "@/components/json-ld";
import "./globals.css";

export const metadata: Metadata = {
  title: "Counted — Privacy-first product analytics",
  description:
    "Privacy-first product analytics with funnels and composable dashboards. No cookies, no fingerprinting, no PII. Under 3KB gzipped.",
  metadataBase: new URL("https://counted.dev"),
  alternates: {
    types: { "application/rss+xml": [{ url: "/feed.xml", title: "Counted Blog" }] },
  },
  openGraph: {
    title: "Counted — Privacy-first product analytics",
    description:
      "Funnels and composable dashboards, no cookies, no consent banner, self-host with Docker Compose. Under 3KB gzipped.",
    url: "https://counted.dev",
    siteName: "Counted",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Counted — Privacy-first product analytics",
    description:
      "Funnels and composable dashboards, no cookies, no consent banner, self-host with Docker Compose. Under 3KB gzipped.",
  },
  robots: {
    index: true,
    follow: true,
  },
  // Search-console ownership verification. The Google token is a PUBLIC value (it
  // ships as a <meta> tag in the page head), so it's hardcoded here rather than an
  // env var — a build-time env var on Railway didn't reliably bake into the static
  // head (build-cache reused stale output). Hardcoding is a source change, so it
  // always rebuilds. Bing stays env-driven (set BING_SITE_VERIFICATION).
  verification: {
    google: "766gLa372Fyei3KrEmrCXSjPCaMw0_HoedORek553po",
    other: process.env.BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
      : undefined,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans">
        <JsonLd data={organizationLd} />
        <JsonLd data={websiteLd} />
        <CountedAnalytics />
        {children}
      </body>
    </html>
  );
}
