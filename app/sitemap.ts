import type { MetadataRoute } from "next";
import { POSTS } from "./(marketing)/blog/posts";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://counted.dev";
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/vs`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/vs/aptabase`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/posthog`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/vs/plausible`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/for/agents`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];

  const postPages: MetadataRoute.Sitemap = POSTS.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticPages, ...postPages];
}
