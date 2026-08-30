import type { MetadataRoute } from "next";
// Relative for the same reason `sitemap.ts` is: `robots.test.ts` imports this
// module from the repo root, where apps/web's tsconfig `paths` are not in scope.
import { SITE_URL } from "../lib/urls";

/** Where `sitemap.ts` is served. Derived, so the two cannot name different URLs. */
export const SITEMAP_URL = `${SITE_URL}/sitemap.xml`;

/**
 * Shared links are not published.
 *
 * The third of three defences, and the only one a crawler sees before it makes
 * a request: the API sends `X-Robots-Tag`, the page emits a `robots` meta, and
 * this keeps a well-behaved crawler from asking at all.
 *
 * `/bff/` too — those routes exist to carry a credential, and there is nothing
 * there for anyone to read.
 *
 * The `Sitemap:` line was missing for as long as there was no sitemap to point
 * at. `sitemap.ts` now exists, and robots.txt is the one place every crawler
 * looks for it without being told — omitting it wastes the sitemap on anything
 * that was not submitted to Search Console by hand.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: ["/share/", "/bff/", "/claim/"] }],
    sitemap: SITEMAP_URL,
  };
}
