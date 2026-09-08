import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, siteOrigin } from "../lib/site";
export const dynamic = "force-dynamic";
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map(path => ({ url: `${siteOrigin()}${path === "/" ? "" : path}`, changeFrequency: path === "/blog" ? "weekly" : "monthly", priority: path === "/" ? 1 : 0.5 }));
}
