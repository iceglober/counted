import type { Metadata } from "next";
import { SiteComparison } from "../../../../components/site-comparison";
export const metadata: Metadata = { title: "Counted vs Plausible", alternates: { canonical: "/vs/plausible" }, description: "Explore Counted’s privacy-first product analytics, API, and composable dashboards alongside Plausible." };
export default function Comparison() { return <SiteComparison slug="plausible"/>; }
