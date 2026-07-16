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
  description: "Privacy-first product analytics with funnels and composable dashboards. No cookies, no fingerprinting, no PII.",
  // Profiles that corroborate the "Counted" entity, so search engines don't
  // conflate it with counter.dev / count.co / Countly. Add X, LinkedIn, and
  // Crunchbase here once those profiles exist (off-site brand task).
  sameAs: [
    "https://github.com/iceglober/counted",
    "https://www.npmjs.com/package/@counted/sdk",
  ],
};

export const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Counted",
  url: SITE,
};

// SoftwareApplication entity — the schema search engines use to give an
// analytics tool a distinct identity (and a shot at a rich result). Prices
// mirror the pricing page; keep them in sync.
export const softwareApplicationLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Counted",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Product Analytics",
  operatingSystem: "Web",
  url: SITE,
  description: "Privacy-first product analytics: custom events, funnels, and composable dashboards. No cookies, no PII, under 3KB gzipped. Instruments AI coding agents with the same SDK.",
  offers: [
    { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Free" },
    { "@type": "Offer", price: "12", priceCurrency: "USD", name: "Pro" },
  ],
  publisher: { "@type": "Organization", name: "Counted", url: SITE },
};

// FAQPage entity — powers a rich result / featured snippet. Used on /vs/counter
// to answer the "is Counted the same as counter.dev?" confusion query.
export function faqPageLd(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

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
