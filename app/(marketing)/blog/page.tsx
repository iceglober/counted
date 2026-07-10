import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav, SiteFooter } from "../site-chrome";
import { visiblePosts } from "./posts";

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
  const posts = visiblePosts();
  return (
    <div>
      <SiteNav />

      <div className="page">
        <h1>Blog</h1>
        <p>
          Short, copy-paste guides. Each one ends with a live dashboard — most get you to a
          working result in five minutes.
        </p>

        {posts.length === 0 ? (
          <p className="muted">Posts coming soon.</p>
        ) : (
          posts.map((post) => (
            <p key={post.slug}>
              <Link href={`/blog/${post.slug}`}>
                <b>{post.title}</b>
              </Link>
              {!post.published && <b> [draft]</b>}
              <br />
              <span className="small muted">
                {formatDate(post.date)} &middot; {post.readingTime} read &middot; {post.category}
              </span>
              <br />
              {post.description}
            </p>
          ))
        )}
      </div>

      <SiteFooter />
    </div>
  );
}
