import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isSiteHost, siteOrigin } from "../lib/site";
export const dynamic = "force-dynamic";
export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = isSiteHost((await headers()).get("host"));
  return site ? { rules: [{ userAgent: "*", allow: "/", disallow: ["/w/", "/api/", "/share/", "/claim", "/account", "/sign-in", "/sign-out", "/welcome", "/design", "/consent", "/oauth/", "/invitations/", "/forgot-password", "/reset-password", "/api-explorer"] }], sitemap: `${siteOrigin()}/sitemap.xml` } : { rules: [{ userAgent: "*", disallow: "/" }] };
}
