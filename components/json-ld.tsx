// Renders a JSON-LD structured-data block. Helps search engines understand the
// site/pages (Organization, WebSite, BlogPosting…) for richer indexing.
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inline; no user input flows in here.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

const SITE = "https://counted.dev";

export const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Counted",
  url: SITE,
  logo: `${SITE}/opengraph-image`,
  description: "Privacy-first product and AI analytics with composable dashboards and agent-native SDKs.",
  sameAs: ["https://github.com/iceglober/counted"],
};

export const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Counted",
  url: SITE,
};

export function blogPostingLd(post: { title: string; description: string; date: string; slug: string }) {
  const url = `${SITE}/blog/${post.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { "@type": "Organization", name: "Counted", url: SITE },
    publisher: {
      "@type": "Organization",
      name: "Counted",
      logo: { "@type": "ImageObject", url: `${SITE}/opengraph-image` },
    },
    url,
    mainEntityOfPage: url,
  };
}
