import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@counted/ui/components/card";
import { PageIntro } from "../../../components/site-chrome";
import { COMPARISONS } from "../../../lib/public-content";
export const metadata: Metadata = { title: "Compare Counted", alternates: { canonical: "/vs" }, description: "Explore Counted alongside Aptabase, Counter.dev, Plausible, and PostHog." };
export default function Compare() { return <><PageIntro title="How Counted compares">A closer look at Counted’s event model, privacy, and composable dashboards.</PageIntro><div className="grid gap-5 md:grid-cols-2">{COMPARISONS.map(item => <Card key={item.slug}><CardHeader><CardTitle><Link href={`/vs/${item.slug}`} className="text-primary-ink hover:underline">Counted vs {item.name}</Link></CardTitle><CardDescription>{item.description}</CardDescription></CardHeader></Card>)}</div></>; }
