import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav, SiteFooter, Eyebrow } from "../site-chrome";
import { sortedPosts } from "./posts";

export const metadata: Metadata = {
  title: "Blog — Counted",
  description:
    "Quickstarts, guides, and notes on privacy-first analytics, agent eval, and self-hosting. Most posts get you to a working result in five minutes.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Counted Blog",
    description: "Quickstarts and guides for privacy-first, agent-native analytics.",
    url: "/blog",
    type: "website",
  },
};

function formatDate(iso: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m, d] = iso.split("-").map(Number);
  return `${months[m - 1]} ${d}, ${y}`;
}

export default function BlogIndex() {
  const posts = sortedPosts();
  return (
    <div className="min-h-screen">
      <SiteNav />

      <section className="px-6 pt-20 pb-10 max-w-2xl mx-auto text-center">
        <Eyebrow>Blog</Eyebrow>
        <h1 className="mt-3 font-display text-3xl md:text-4xl tracking-tight">Working analytics in five minutes</h1>
        <p className="mt-4 text-text-secondary leading-relaxed">
          Short, copy-paste guides. Each one ends with a live dashboard.
        </p>
      </section>

      <section className="px-6 pb-20 max-w-2xl mx-auto">
        {posts.length === 0 ? (
          <p className="text-center text-text-tertiary text-sm py-10 border-t border-border">
            Posts coming soon.
          </p>
        ) : (
        <div className="divide-y divide-border border-t border-border">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group block py-6 transition-colors"
            >
              <div className="flex items-center gap-3 text-xs text-text-tertiary">
                <span className="text-accent font-medium tracking-wide uppercase">{post.category}</span>
                <span>·</span>
                <span>{formatDate(post.date)}</span>
                <span>·</span>
                <span>{post.readingTime} read</span>
              </div>
              <h2 className="mt-2 font-display text-lg md:text-xl tracking-tight group-hover:text-accent transition-colors">
                {post.title}
              </h2>
              <p className="mt-2 text-sm text-text-secondary leading-relaxed">{post.description}</p>
            </Link>
          ))}
        </div>
        )}
      </section>

      <SiteFooter />
    </div>
  );
}
