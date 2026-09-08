import type { Metadata } from "next";
import { SiteComparison } from "../../../../components/site-comparison";
export const metadata: Metadata = { title: "Counted vs PostHog", alternates: { canonical: "/vs/posthog" }, description: "Explore Counted’s privacy-first product analytics, API, and composable dashboards alongside PostHog." };
export default function Comparison() { return <SiteComparison slug="posthog"/>; }
