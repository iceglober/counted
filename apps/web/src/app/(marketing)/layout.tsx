import type { Metadata } from "next";
import { SiteChrome } from "../../components/site-chrome";
import { publicSiteMetadata } from "../../lib/site-metadata";
// Public link destinations must come from deployment-time configuration.
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return {
    ...publicSiteMetadata(),
    title: { default: "Counted", template: "%s — Counted" },
  };
}
export default function MarketingLayout({ children }: { children: React.ReactNode }) { return <SiteChrome>{children}</SiteChrome>; }
