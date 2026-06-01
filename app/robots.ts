import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboards", "/events", "/projects", "/settings"],
      },
    ],
    sitemap: "https://counted.dev/sitemap.xml",
  };
}
