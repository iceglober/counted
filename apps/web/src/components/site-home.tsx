import Link from "next/link";
import { Badge } from "@counted/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@counted/ui/components/card";
import { SiteChrome, SiteLinkButton, CodeBlock } from "./site-chrome";
import { consoleOrigin } from "../lib/env";
import { docsOrigin } from "../lib/site";
export function SiteHome() {
  return <SiteChrome>
    <section className="grid items-start gap-12 pb-16 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pb-24">
      <div className="space-y-7">
        <Badge variant="outline">Open source · self-hostable</Badge>
        <h1 className="max-w-2xl font-heading text-5xl leading-[1.08] tracking-tight sm:text-6xl">Privacy-first<br/><span className="text-muted-foreground">product analytics.</span></h1>
        <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">Custom events, funnels, and dashboards you compose yourself. No tracking cookies. No fingerprinting.</p>
        <div className="flex flex-wrap gap-3"><SiteLinkButton href={`${consoleOrigin()}/sign-in`}>Start free</SiteLinkButton><SiteLinkButton href={`${docsOrigin()}/getting-started`} variant="outline">Read the docs</SiteLinkButton></div>
        <p className="text-xs text-muted-foreground">100,000 events a month. No credit card.</p>
      </div>
      <Card className="mt-1"><CardHeader><CardTitle>One event. More answers.</CardTitle><CardDescription>Use the properties you already send.</CardDescription></CardHeader><CardContent className="space-y-6">
        <CodeBlock>{`import { Counted } from "@counted/sdk";

const counted = new Counted({\n  key: "YOUR_INGEST_KEY"\n});
counted.track("page_view", {
  path: "/pricing",
  source: "docs"
});`}</CodeBlock>
        <div className="divide-y border-t">{[["Count", "How often did it happen?"], ["Breakdown", "Which paths and sources?"], ["Funnel", "What happened next?"]].map(([name, description]) => <div key={name} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="font-medium">{name}</span><span className="text-muted-foreground">{description}</span></div>)}</div>
      </CardContent></Card>
    </section>
    <section className="border-t py-12 sm:py-16">
      <div className="mb-9 flex flex-wrap items-baseline justify-between gap-4"><h2 className="font-heading text-3xl">Why Counted</h2><Link href="/about" className="text-sm text-primary-ink underline underline-offset-4">About the project</Link></div>
      <div className="grid gap-5 md:grid-cols-3">{[
        ["Privacy by design", "Visits stay ephemeral. The SDK keeps a visit id in memory and does not store a tracking identifier in cookies or local storage."],
        ["Composable dashboards", "Combine counts, time series, property breakdowns, and ordered funnels. Arrange and resize Insights to fit the question."],
        ["Your data, your tools", "Use the API, SDKs, or the app. The code is open source and runs on plain PostgreSQL when you self-host."],
      ].map(([title, description]) => <Card key={title}><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader></Card>)}</div>
    </section>
    <section className="flex flex-col justify-between gap-6 border-t pt-12 sm:flex-row sm:items-center sm:pt-16"><div className="max-w-xl space-y-3"><h2 className="font-heading text-3xl">The same event model for your agents.</h2><p className="text-sm leading-relaxed text-muted-foreground">Tool usage, file edits, commands, and outcomes. Capture the shape of the work without sending prompts or code contents.</p></div><SiteLinkButton href="/for/agents" variant="outline">Explore agent analytics</SiteLinkButton></section>
  </SiteChrome>;
}
