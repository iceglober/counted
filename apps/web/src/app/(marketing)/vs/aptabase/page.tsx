import type { Metadata } from "next";
import { SiteNav, SiteFooter, CodeBlock } from "../../site-chrome";
import { TrackedCTA } from "../../track";

export const metadata: Metadata = {
  title: "Counted vs Aptabase — privacy analytics with composable dashboards",
  description:
    "Counted vs Aptabase: composable dashboards, funnels, a larger free tier, and a migration CLI. Both privacy-first and cookie-free.",
  alternates: { canonical: "/vs/aptabase" },
  openGraph: {
    title: "Counted vs Aptabase",
    description:
      "Composable dashboards and funnels, a larger free tier, and a migration CLI — both privacy-first and cookie-free.",
    url: "/vs/aptabase",
    type: "article",
    images: ["/og?title=Counted%20vs%20Aptabase&eyebrow=Comparison"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Counted vs Aptabase",
    description: "Composable dashboards and funnels, a larger free tier, and a migration CLI.",
    images: ["/og?title=Counted%20vs%20Aptabase&eyebrow=Comparison"],
  },
};

type Row = { label: string; counted: string | boolean; aptabase: string | boolean };

const ROWS: Row[] = [
  { label: "No cookies, no fingerprinting", counted: true, aptabase: true },
  { label: "GDPR/CCPA without a consent banner", counted: true, aptabase: true },
  { label: "Composable dashboards (custom insights)", counted: true, aptabase: false },
  { label: "Funnels", counted: true, aptabase: false },
  { label: "Agent-native SDKs (Claude Code, OpenCode, Codex, Gemini)", counted: true, aptabase: false },
  { label: "Web & backend SDKs", counted: "JS/TS + React (more soon)", aptabase: "JS, Swift, Kotlin, +more" },
  { label: "Mobile SDKs (Swift, Kotlin)", counted: "On the roadmap", aptabase: true },
  { label: "SDK size (web)", counted: "<3KB gzipped", aptabase: "~3KB" },
  { label: "Self-host (Docker)", counted: "Docker Compose", aptabase: true },
  { label: "Free tier events / month", counted: "100K", aptabase: "20K" },
  { label: "Migration CLI", counted: "@counted/migrate", aptabase: false },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <>Yes</>;
  if (value === false) return <>&mdash;</>;
  return <>{value}</>;
}

export default function VsAptabasePage() {
  return (
    <div>
      <SiteNav />

      <div className="page">
        <h1>Counted vs Aptabase</h1>
        <p>
          Both reject cookies, fingerprinting, and PII. Counted adds composable dashboards,
          funnels, a larger free tier, and a CLI to bring your history over.
        </p>
        <p>
          <TrackedCTA href="/login" location="vs_aptabase" label="start_free">
            Start free
          </TrackedCTA>{" "}
          &nbsp;or&nbsp; <a href="#migrate">how to migrate</a>
        </p>

        <table>
          <thead>
            <tr>
              <th style={{ width: "50%" }}>Feature</th>
              <th className="c">Counted</th>
              <th className="c">Aptabase</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="c"><Cell value={row.counted} /></td>
                <td className="c"><Cell value={row.aptabase} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Based on public docs at the time of writing. Check Aptabase&apos;s site for current
          limits.
        </p>

        <h2 id="migrate">Migrate in two steps</h2>

        <p>
          <b>1. Import your events.</b>{" "}Point <code>@counted/migrate</code> at your self-hosted
          Aptabase ClickHouse (or a CSV export), scoped to your app id, plus your Counted
          project key.
        </p>
        <CodeBlock>{`npx @counted/migrate \\
  --source-clickhouse "http://default:PASSWORD@your-aptabase-host:8123" \\
  --app-id "YOUR_APTABASE_APP_ID" \\
  --target-key "ck_your_project_key" \\
  --target-host "https://app.counted.dev"`}</CodeBlock>

        <p>
          <b>2. Swap the SDK.</b>{" "}Change one import. The drop-in shim keeps Aptabase&apos;s{" "}
          <code>init</code> / <code>trackEvent</code> API — same call sites, only the key
          changes.
        </p>
        <p className="small muted">&mdash; before (Aptabase)</p>
        <CodeBlock>{`import { init, trackEvent } from "@aptabase/web";

init("A-EU-0000000000");
trackEvent("plan_selected", { plan: "premium" });`}</CodeBlock>
        <p className="small muted">+ after (Counted — drop-in shim)</p>
        <CodeBlock>{`import { init, trackEvent } from "@counted/sdk/aptabase";

init("ck_your_project_key");
trackEvent("plan_selected", { plan: "premium" });`}</CodeBlock>

        <p>
          When you&apos;re ready, switch to the native Analytics API for the full
          feature set (super-properties, richer typing):
        </p>
        <CodeBlock>{`import { Analytics } from "@counted/sdk";

const counted = new Analytics({ projectKey: "ck_..." });
counted.track("plan_selected", { plan: "premium" });`}</CodeBlock>

        <p>
          <TrackedCTA href="/login" location="vs_aptabase" label="create_migrate">
            Create a project &amp; migrate
          </TrackedCTA>
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}
