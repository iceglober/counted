import type { Metadata } from "next";
import { SiteComparison } from "../../../../components/site-comparison";
export const metadata: Metadata = { title: "Counted vs Counter.dev", alternates: { canonical: "/vs/counter" }, description: "Explore Counted’s privacy-first product analytics, API, and composable dashboards alongside Counter.dev." };
export default function Comparison() { return <SiteComparison slug="counter"/>; }
