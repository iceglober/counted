import type { MetadataRoute } from "next";

/**
 * Shared links are not published.
 *
 * The third of three defences, and the only one a crawler sees before it makes
 * a request: the API sends `X-Robots-Tag`, the page emits a `robots` meta, and
 * this keeps a well-behaved crawler from asking at all.
 *
 * `/bff/` too — those routes exist to carry a credential, and there is nothing
 * there for anyone to read.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: ["/share/", "/bff/", "/claim/"] }],
  };
}
