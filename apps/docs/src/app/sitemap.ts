import type { MetadataRoute } from "next";
import { publicUrls } from "../lib/deployment";
export const dynamic = "force-dynamic";
export default function sitemap(): MetadataRoute.Sitemap {
  const urls = publicUrls();
  return [
    { url: urls.docs, changeFrequency: "weekly", priority: 1 },
    {
      url: `${urls.docs}/getting-started`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
