import type { Metadata } from "next";
import { SiteComparison } from "../../../../components/site-comparison";
export const metadata: Metadata = { title: "Counted vs Aptabase", alternates: { canonical: "/vs/aptabase" }, description: "Explore Counted’s privacy-first product analytics, API, and composable dashboards alongside Aptabase." };
export default function Comparison() { return <SiteComparison slug="aptabase"/>; }
