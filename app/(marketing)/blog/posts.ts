// Registry of blog posts. Listing metadata lives here so the index page and the
// sitemap stay in sync; each post's full content lives in its own route page.
//
// Visibility in production = `published: true` AND `date` has arrived. A post
// with a future `date` is *scheduled*: hidden from the index, sitemap, RSS,
// IndexNow, and 404 on its own URL until its day, then it surfaces automatically
// (the blog routes use ISR — see blog/layout.tsx — so the date gate re-evaluates
// without a redeploy). This gives a drip cadence instead of one same-day dump.
//
// PREVIEW: in dev (`bun run dev`) — or with SHOW_DRAFTS=1 — every post is visible
// regardless of `published`/`date`, so drafts and scheduled posts can be reviewed.

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO yyyy-mm-dd — also the scheduled go-live date
  readingTime: string;
  category: string;
  published: boolean;
};

export const POSTS: PostMeta[] = [];

export function getPost(slug: string): PostMeta | undefined {
  return POSTS.find((p) => p.slug === slug);
}

// When true, every post is visible regardless of published/date — dev only by
// default; set SHOW_DRAFTS=1 to force it on a deployed preview.
export const PREVIEW =
  process.env.NODE_ENV !== "production" || process.env.SHOW_DRAFTS === "1";

const today = () => new Date().toISOString().slice(0, 10);
const byNewest = (a: PostMeta, b: PostMeta) => (a.date < b.date ? 1 : -1);

// Live in production = published AND its scheduled date has arrived. ISR on the
// blog routes re-evaluates this so scheduled posts surface on their day.
export function isLive(p: PostMeta): boolean {
  return p.published && p.date <= today();
}

// Live posts only, newest first — used by the sitemap, RSS, IndexNow, and the
// prod index. Never leaks unpublished or not-yet-due posts into discovery.
export function sortedPosts(): PostMeta[] {
  return POSTS.filter(isLive).sort(byNewest);
}

// Posts to list on the blog index: live in prod; everything (drafts + scheduled)
// in preview so they can be reviewed before they go out.
export function visiblePosts(): PostMeta[] {
  return (PREVIEW ? [...POSTS] : POSTS.filter(isLive)).sort(byNewest);
}
