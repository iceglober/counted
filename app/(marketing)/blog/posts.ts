// Registry of blog posts. Listing metadata lives here so the index page and the
// sitemap stay in sync; each post's full content lives in its own route page.
// When the agentic content pipeline lands (ROADMAP phase 3), it appends entries
// here and writes the matching page.

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO yyyy-mm-dd
  readingTime: string;
  category: string;
};

export const POSTS: PostMeta[] = [
  {
    slug: "ai-native-product-analytics-in-5-minutes",
    title: "Set up AI-native product analytics in 5 minutes",
    description:
      "Install the SDK, send your first event, and read it on a live dashboard — no cookies, no PII, under 3KB.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
  },
  {
    slug: "claude-code-eval-in-5-minutes",
    title: "Track your Claude Code agent eval in 5 minutes",
    description:
      "Capture tool calls, file edits, commands, and outcomes from Claude Code into a pre-built eval dashboard — privacy-safe, via the native plugin.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
  },
  {
    slug: "opencode-eval-in-5-minutes",
    title: "Track your OpenCode agent eval in 5 minutes",
    description:
      "Capture tool calls, file edits, commands, and outcomes from OpenCode into a pre-built eval dashboard — privacy-safe, via the native plugin.",
    date: "2026-06-02",
    readingTime: "5 min",
    category: "Quickstart",
  },
];

export function getPost(slug: string): PostMeta | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function sortedPosts(): PostMeta[] {
  return [...POSTS].sort((a, b) => (a.date < b.date ? 1 : -1));
}
