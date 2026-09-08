import type { Metadata } from "next";
import { siteOrigin } from "./site";

/** Shared public preview; never reads an account, workspace, or dashboard. */
export function publicSiteMetadata(): Metadata {
  const metadataBase = new URL(siteOrigin());
  const image = {
    url: new URL("/images/counted-dashboard.png", metadataBase),
    width: 1200,
    height: 630,
    alt: "A Counted dashboard showing charts, totals, and property breakdowns.",
  };
  return {
    metadataBase,
    // Next inherits each public page's title and description. The relative
    // URL resolves its pathname against the configured public-site origin.
    openGraph: {
      type: "website",
      siteName: "Counted",
      url: "./",
      images: [{ ...image, type: "image/png" }],
    },
    twitter: { card: "summary_large_image", images: [image] },
  };
}
