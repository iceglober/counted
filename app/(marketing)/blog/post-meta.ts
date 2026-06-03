import type { Metadata } from "next";
import { getPost } from "./posts";

// Builds a blog post's metadata, including a per-post share image (/og with the
// post's title) so shared links render the article's own title, not a generic
// card. One place to evolve post SEO/OG.
export function postMetadata(slug: string): Metadata {
  const meta = getPost(slug)!;
  const og = `/og?title=${encodeURIComponent(meta.title)}&eyebrow=${encodeURIComponent(meta.category)}`;
  return {
    title: `${meta.title} — Counted`,
    description: meta.description,
    alternates: { canonical: `/blog/${meta.slug}` },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: `/blog/${meta.slug}`,
      type: "article",
      images: [og],
    },
    twitter: { card: "summary_large_image", title: meta.title, description: meta.description, images: [og] },
  };
}
