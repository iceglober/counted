import type { MetadataRoute } from "next";
import { publicUrls } from "../lib/deployment";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${publicUrls().docs}/sitemap.xml`,
  };
}
