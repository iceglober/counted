import type { Metadata } from "next";
import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("rust-analytics-in-5-minutes")!;

export const metadata: Metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        Rust services deserve product analytics too. The <code className="font-mono text-text-primary">counted-sdk</code>{" "}
        crate is thread-safe and flushes on drop, so you can track real events — privacy-first, no
        PII — in about five minutes.
      </Lead>

      <Step n={1} title="Get a project key">
        <P>
          Create a project and copy its <code className="font-mono text-text-primary">ck_</code> client key — or mint
          one with no signup:
        </P>
        <div className="mt-3">
          <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
        </div>
      </Step>

      <Step n={2} title="Add the crate">
        <div className="mt-1">
          <CodeBlock>{`# Cargo.toml — imported as \`counted\`
[dependencies]
counted-sdk = "0.1"`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Initialize and track">
        <P>Create the client once; it flushes automatically when it&apos;s dropped.</P>
        <div className="mt-3">
          <CodeBlock>{`use counted::Analytics;

fn main() {
    let analytics = Analytics::new("ck_your_project_key");

    analytics.track("user_signup", Some([("plan".into(), "free".into())].into()));
    analytics.track("invoice_paid", Some([("amount".into(), "29".into())].into()));

    analytics.flush(); // or just let it flush on drop
}`}</CodeBlock>
        </div>
        <P>Properties are plain string values — no user IDs or PII. Your event shows up on the dashboard within a second or two.</P>
      </Step>

      <Step n={4} title="Configure for a service">
        <P>
          For a long-running service, build the client with the options you want and share it across
          threads — it&apos;s thread-safe (<code className="font-mono text-text-primary">Arc&lt;Mutex&gt;</code> internally):
        </P>
        <div className="mt-3">
          <CodeBlock>{`use counted::{Analytics, Options};
use std::time::Duration;

let analytics = Analytics::with_options(Options {
    project_key: "ck_your_project_key".into(),
    host: "https://app.counted.dev".into(), // or your self-hosted URL
    flush_interval: Duration::from_secs(10),
    ..Default::default()
});`}</CodeBlock>
        </div>
      </Step>

      <Step n={5} title="Tracking an AI agent? Use explicit sessions">
        <P>
          For a long-running agent, set an explicit session id and disable auto-reset so a whole
          run groups together:
        </P>
        <div className="mt-3">
          <CodeBlock>{`let analytics = Analytics::with_options(Options {
    project_key: "ck_your_project_key".into(),
    session_id: Some(run_id),
    session_timeout: Duration::ZERO, // never auto-reset
    flush_interval: Duration::from_secs(10),
    ..Default::default()
});

analytics.track("tool_use", Some([("tool".into(), "web_search".into())].into()));`}</CodeBlock>
        </div>
        <P>From here, build the dashboard you want — funnels, retention, per-tool breakdowns — all composable on top of the events you send.</P>
      </Step>
    </PostLayout>
  );
}
