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

export const POSTS: PostMeta[] = [
  {
    slug: "what-ai-native-means",
    title: "What does it mean to be “AI-native”?",
    description:
      "AI-native isn't a chatbot bolted into the corner of your app. It's treating the agent as a first-class actor in your product — including in how you measure it. A short argument for a new default.",
    date: "2026-06-20",
    readingTime: "6 min",
    category: "Perspective",
    published: true,
  },
  {
    slug: "privacy-first-why",
    title: "Privacy-first. Why?",
    description:
      "Most analytics is built on surveillance you never needed. Privacy-first isn't a compliance checkbox for us — it's the founding bet. Here's the argument, and the business case behind it.",
    date: "2026-06-01",
    readingTime: "6 min",
    category: "Perspective",
    published: true,
  },
  {
    slug: "no-cookies-how",
    title: "Why we don't use cookies — and what we do instead",
    description:
      "No cookies, no localStorage id, no fingerprint. So how does Counted count anything? The ephemeral session model explained — including the honest tradeoffs of giving up identity.",
    date: "2026-06-03",
    readingTime: "7 min",
    category: "Perspective",
    published: true,
  },
  {
    slug: "public-dashboard-in-5-minutes",
    title: "Ship a public metrics dashboard in 5 minutes",
    description:
      "Build a dashboard, then share it as a read-only public link — no login required. Perfect for a status page, a launch metric, or open startup metrics.",
    date: "2026-06-06",
    readingTime: "5 min",
    category: "Quickstart",
    published: true,
  },
  {
    slug: "ai-native-product-analytics-in-5-minutes",
    title: "Set up AI-native product analytics in 5 minutes",
    description:
      "Install the SDK, send your first event, and read it on a live dashboard — no cookies, no PII, under 3KB.",
    date: "2026-06-24",
    readingTime: "5 min",
    category: "Quickstart",
    published: true,
  },
  {
    slug: "counted-in-any-language",
    title: "Counted in any language",
    description:
      "One privacy-first analytics model, the same event shape everywhere. Copy-paste quickstarts for JavaScript, React/Next.js, Python, Go, and Rust — install, track, flush.",
    date: "2026-06-10",
    readingTime: "7 min",
    category: "Quickstart",
    // Pulled 2026-06-12: documents Python/Go/Rust SDKs that aren't released yet
    // (policy: an SDK ships only once a live example exists). Re-publish
    // per-language as each SDK earns its live example.
    published: false,
  },
  {
    slug: "self-host-counted-in-5-minutes",
    title: "Self-host Counted in 5 minutes",
    description:
      "Run Counted on your own infrastructure with Docker Compose — your data never leaves your servers. Clone, configure, up.",
    date: "2026-06-13",
    readingTime: "5 min",
    category: "Quickstart",
    published: true,
  },
  {
    slug: "nextjs-analytics-in-5-minutes",
    title: "Add product analytics to your Next.js app in 5 minutes",
    description:
      "Drop @counted/react into a Next.js App Router app, track your first event, and auto-track page views — no cookies, under 3KB.",
    date: "2026-06-17",
    readingTime: "5 min",
    category: "Quickstart",
    published: true,
  },
  {
    slug: "claude-code-eval-in-5-minutes",
    title: "Track your Claude Code agent eval in 5 minutes",
    description:
      "Capture tool calls, file edits, commands, and outcomes from Claude Code into a pre-built eval dashboard — privacy-safe, via the native plugin.",
    date: "2026-06-27",
    readingTime: "5 min",
    category: "Quickstart",
    published: true,
  },
  {
    slug: "opencode-eval-in-5-minutes",
    title: "Track your OpenCode agent eval in 5 minutes",
    description:
      "Capture tool calls, file edits, commands, and outcomes from OpenCode into a pre-built eval dashboard — privacy-safe, via the native plugin.",
    date: "2026-07-01",
    readingTime: "5 min",
    category: "Quickstart",
    published: true,
  },
  {
    slug: "sveltekit-analytics-in-5-minutes",
    title: "Add product analytics to your SvelteKit app in 5 minutes",
    description:
      "Drop @counted/sdk into any SvelteKit app, auto-track page views across routes, and fire custom events — no cookies, under 3KB gzipped.",
    date: "2026-07-29",
    readingTime: "5 min",
    category: "Quickstart",
    published: true,
  },
  {
    slug: "astro-analytics-in-5-minutes",
    title: "Add product analytics to your Astro site in 5 minutes",
    description:
      "Drop @counted/sdk into any Astro site — static, SSR, or hybrid — auto-track page views, and fire custom events. No cookies, under 3KB gzipped.",
    date: "2026-08-05",
    readingTime: "5 min",
    category: "Quickstart",
    published: true,
  },
  {
    slug: "nuxt-analytics-in-5-minutes",
    title: "Add product analytics to your Nuxt 3 app in 5 minutes",
    description:
      "Drop @counted/sdk into any Nuxt 3 app as a client-side plugin — auto-track page views via router.afterEach, fire custom events anywhere. No cookies, under 3KB.",
    date: "2026-08-12",
    readingTime: "5 min",
    category: "Quickstart",
    published: true,
  },
  {
    slug: "angular-analytics-in-5-minutes",
    title: "Add product analytics to your Angular app in 5 minutes",
    description:
      "Drop @counted/sdk into any Angular 17+ app, auto-track page views with the Router, and fire custom events from any component — no cookies, under 3KB.",
    date: "2026-09-02",
    readingTime: "5 min",
    category: "Quickstart",
    published: true,
  },
];

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
