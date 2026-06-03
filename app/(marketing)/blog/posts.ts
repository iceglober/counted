// Registry of blog posts. Listing metadata lives here so the index page and the
// sitemap stay in sync; each post's full content lives in its own route page.
//
// `published` gates visibility in production (index, post page 404, sitemap,
// RSS, IndexNow). All posts are currently UNPUBLISHED pending a human review
// pass — flip `published: true` per post to take it live (it then auto-indexes).
//
// PREVIEW: in dev (`bun run dev`) — or with SHOW_DRAFTS=1 — unpublished posts
// render and appear in the index so you can review them locally. Production
// builds set NODE_ENV=production, so drafts stay 404/hidden there.

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO yyyy-mm-dd
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
    date: "2026-06-03",
    readingTime: "6 min",
    category: "Perspective",
    published: false,
  },
  {
    slug: "public-dashboard-in-5-minutes",
    title: "Ship a public metrics dashboard in 5 minutes",
    description:
      "Build a dashboard, then share it as a read-only public link — no login required. Perfect for a status page, a launch metric, or open startup metrics.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
    published: false,
  },
  {
    slug: "ai-native-product-analytics-in-5-minutes",
    title: "Set up AI-native product analytics in 5 minutes",
    description:
      "Install the SDK, send your first event, and read it on a live dashboard — no cookies, no PII, under 3KB.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
    published: false,
  },
  {
    slug: "rust-analytics-in-5-minutes",
    title: "Instrument a Rust service in 5 minutes",
    description:
      "Add privacy-first analytics to a Rust service with the counted-sdk crate — thread-safe, flushes on drop. No PII.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
    published: false,
  },
  {
    slug: "go-analytics-in-5-minutes",
    title: "Instrument a Go service in 5 minutes",
    description:
      "Add privacy-first analytics to a Go service with the zero-dependency counted SDK — track events, flush cleanly on shutdown. No PII.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
    published: false,
  },
  {
    slug: "python-analytics-in-5-minutes",
    title: "Instrument a Python service in 5 minutes",
    description:
      "Add privacy-first analytics to a Python service with the zero-dependency counted SDK — track events, flush cleanly on shutdown. No PII.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
    published: false,
  },
  {
    slug: "self-host-counted-in-5-minutes",
    title: "Self-host Counted in 5 minutes",
    description:
      "Run Counted on your own infrastructure with Docker Compose — your data never leaves your servers. Clone, configure, up.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
    published: false,
  },
  {
    slug: "nextjs-analytics-in-5-minutes",
    title: "Add product analytics to your Next.js app in 5 minutes",
    description:
      "Drop @counted/react into a Next.js App Router app, track your first event, and auto-track page views — no cookies, under 3KB.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
    published: false,
  },
  {
    slug: "claude-code-eval-in-5-minutes",
    title: "Track your Claude Code agent eval in 5 minutes",
    description:
      "Capture tool calls, file edits, commands, and outcomes from Claude Code into a pre-built eval dashboard — privacy-safe, via the native plugin.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
    published: false,
  },
  {
    slug: "opencode-eval-in-5-minutes",
    title: "Track your OpenCode agent eval in 5 minutes",
    description:
      "Capture tool calls, file edits, commands, and outcomes from OpenCode into a pre-built eval dashboard — privacy-safe, via the native plugin.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
    published: false,
  },
];

export function getPost(slug: string): PostMeta | undefined {
  return POSTS.find((p) => p.slug === slug);
}

// When true, unpublished drafts are visible (index + post pages). Dev-only by
// default; set SHOW_DRAFTS=1 to force it on a deployed preview.
export const PREVIEW =
  process.env.NODE_ENV !== "production" || process.env.SHOW_DRAFTS === "1";

const byNewest = (a: PostMeta, b: PostMeta) => (a.date < b.date ? 1 : -1);

// Published posts only, newest first — used by the sitemap, RSS, IndexNow (and
// the index in production). Never leaks drafts into discovery surfaces.
export function sortedPosts(): PostMeta[] {
  return POSTS.filter((p) => p.published).sort(byNewest);
}

// Posts to list on the blog index: published in prod, published + drafts in
// preview. Discovery surfaces (sitemap/RSS/IndexNow) still use sortedPosts().
export function visiblePosts(): PostMeta[] {
  return POSTS.filter((p) => p.published || PREVIEW).sort(byNewest);
}
