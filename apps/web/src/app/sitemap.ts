import type { MetadataRoute } from "next";
// Relative, not `@/lib/urls`, deliberately: `sitemap.test.ts` imports this
// module for PUBLIC_ROUTES, and `bun test` runs from the repo root where
// apps/web's tsconfig `paths` are not in scope. The alias resolves in the Next
// build and fails in the test, which is the worst of both.
import { SITE_URL } from "../lib/urls";
import { isLive, POSTS } from "./(marketing)/blog/posts";

/**
 * The sitemap.
 *
 * v1 had one and it was never ported, so v2 shipped without `/sitemap.xml` at
 * all — it 404'd. Search Console's "Discovered – currently not indexed" against
 * seventeen pages is the direct consequence: Google had found URLs and had
 * nothing telling it they mattered or when they changed.
 *
 * **Only public pages belong here.** The console routes (`/projects`,
 * `/dashboards`, `/settings`, `/sign-in`, `/start`) are behind auth and would
 * be crawled straight into a redirect, and `/claim/*` and `/share/*` are
 * capability URLs — listing them would publish a capability. `robots.ts`
 * already disallows the latter two; a sitemap that contradicted it would be
 * asking Google to fetch what we just told it not to.
 *
 * Regenerated periodically so future-dated posts enter the sitemap on the day
 * they go live rather than at the next deploy.
 */
export const revalidate = 21_600; // 6 hours

/**
 * Public routes, as paths. Kept as data rather than inline objects so
 * `sitemap.test.ts` can compare this list against the actual `page.tsx` tree —
 * a hand-maintained list and a directory of routes are two descriptions of one
 * set, and the way they drift is a new page nobody submits to Google.
 */
export const PUBLIC_ROUTES: ReadonlyArray<{
  readonly path: string;
  readonly changeFrequency: "weekly" | "monthly" | "yearly";
  readonly priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/api", changeFrequency: "monthly", priority: 0.7 },
  { path: "/for/agents", changeFrequency: "monthly", priority: 0.8 },
  { path: "/vs", changeFrequency: "monthly", priority: 0.6 },
  { path: "/vs/aptabase", changeFrequency: "monthly", priority: 0.8 },
  { path: "/vs/posthog", changeFrequency: "monthly", priority: 0.8 },
  { path: "/vs/plausible", changeFrequency: "monthly", priority: 0.8 },
  { path: "/vs/counter", changeFrequency: "monthly", priority: 0.8 },
  { path: "/blog", changeFrequency: "weekly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.5 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const pages: MetadataRoute.Sitemap = PUBLIC_ROUTES.map((r) => ({
    url: r.path === "/" ? SITE_URL : `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // Unpublished and future-dated posts are excluded by `isLive`, so a draft
  // cannot be announced to Google before it is readable.
  const posts: MetadataRoute.Sitemap = POSTS.filter(isLive).map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "yearly",
    priority: 0.6,
  }));

  return [...pages, ...posts];
}
