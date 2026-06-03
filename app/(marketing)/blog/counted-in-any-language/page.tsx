import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, H2 } from "../post-layout";

const meta = getPost("counted-in-any-language")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        Counted speaks your stack. The SDKs differ in syntax but not in shape: get a key, send an
        event, flush before you exit. Privacy-first, no PII, the same ephemeral session model
        everywhere. Pick your language below — each one is a copy-paste away from a live dashboard.
      </Lead>

      <H2>One model, every language</H2>
      <P>
        Wherever you call it from, an event is an event name plus plain-value properties — strings,
        numbers, booleans. There&apos;s no field for a user id or an email, because Counted
        doesn&apos;t store them. The session id is generated in memory and shared across instances in
        the same runtime, so a visit&apos;s events connect into a funnel. The only per-language
        difference worth remembering is <em>how you flush</em> before a process ends.
      </P>

      <H2>Get a project key</H2>
      <P>
        Create a project and copy its <code className="font-mono text-text-primary">ck_</code> client
        key — or mint one with no signup. It&apos;s write-only, safe to ship in a client:
      </P>
      <div className="mt-3">
        <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
      </div>

      <H2>JavaScript / TypeScript</H2>
      <P>The zero-dependency core SDK — browser, Node, Bun, Deno, or an edge runtime:</P>
      <div className="mt-3">
        <CodeBlock>{`npm install @counted/sdk`}</CodeBlock>
      </div>
      <div className="mt-3">
        <CodeBlock>{`import { Analytics } from "@counted/sdk";

const counted = new Analytics({ projectKey: "ck_your_project_key" });
counted.track("user_signup", { plan: "free" });
counted.track("invoice_paid", { amount: 29, currency: "usd" });

await counted.flush();   // before a short-lived process exits`}</CodeBlock>
      </div>

      <H2>React &amp; Next.js</H2>
      <P>
        For a frontend, <code className="font-mono text-text-primary">@counted/react</code> wraps the
        core SDK in a provider and a hook:
      </P>
      <div className="mt-3">
        <CodeBlock>{`npm install @counted/react`}</CodeBlock>
      </div>
      <div className="mt-3">
        <CodeBlock>{`import { CountedProvider, useCounted } from "@counted/react";

// wrap your app
<CountedProvider projectKey="ck_your_project_key">
  <App />
</CountedProvider>;

// then anywhere inside it
const counted = useCounted();
counted.track("cta_click", { location: "hero" });`}</CodeBlock>
      </div>
      <P>
        The browser flushes automatically when the tab is hidden, so you rarely call{" "}
        <code className="font-mono text-text-primary">flush()</code> yourself. For the full App Router
        walkthrough, see{" "}
        <a href="/blog/nextjs-analytics-in-5-minutes" className="text-accent hover:text-accent-hover transition-colors">
          analytics for Next.js in 5 minutes
        </a>
        .
      </P>

      <H2>Python</H2>
      <P>Zero-dependency and thread-safe. The simplest path is a module-level client:</P>
      <div className="mt-3">
        <CodeBlock>{`pip install counted`}</CodeBlock>
      </div>
      <div className="mt-3">
        <CodeBlock>{`import counted

counted.init("ck_your_project_key")
counted.track("user_signup", {"plan": "free"})
counted.track("invoice_paid", {"amount": 29, "currency": "usd"})`}</CodeBlock>
      </div>
      <P>In a service or short-lived job, use the class-based client and flush on shutdown:</P>
      <div className="mt-3">
        <CodeBlock>{`from counted import Analytics

analytics = Analytics(
    project_key="ck_your_project_key",
    host="https://app.counted.dev",  # or your self-hosted URL
    flush_interval=10.0,
)
analytics.track("job_finished", {"processed": 128})
analytics.flush()
analytics.destroy()`}</CodeBlock>
      </div>

      <H2>Go</H2>
      <P>Zero-dependency and goroutine-safe. A global client, flushed on shutdown:</P>
      <div className="mt-3">
        <CodeBlock>{`go get github.com/iceglober/counted/packages/go`}</CodeBlock>
      </div>
      <div className="mt-3">
        <CodeBlock>{`package main

import counted "github.com/iceglober/counted/packages/go"

func main() {
    counted.Init(counted.Options{ProjectKey: "ck_your_project_key"})
    defer counted.DestroyGlobal() // flush before exit

    counted.TrackEvent("user_signup", counted.EventProperties{"plan": "free"})
}`}</CodeBlock>
      </div>
      <P>
        For a long-running service, build an instance with{" "}
        <code className="font-mono text-text-primary">counted.New(...)</code> and share it across
        handlers — it&apos;s goroutine-safe; <code className="font-mono text-text-primary">defer
        analytics.Destroy()</code> flushes on shutdown.
      </P>

      <H2>Rust</H2>
      <P>
        The <code className="font-mono text-text-primary">counted-sdk</code> crate is thread-safe and
        flushes on drop:
      </P>
      <div className="mt-3">
        <CodeBlock>{`# Cargo.toml — imported as \`counted\`
[dependencies]
counted-sdk = "0.1"`}</CodeBlock>
      </div>
      <div className="mt-3">
        <CodeBlock>{`use counted::Analytics;

fn main() {
    let analytics = Analytics::new("ck_your_project_key");
    analytics.track("user_signup", Some([("plan".into(), "free".into())].into()));
    analytics.flush(); // or just let it flush on drop
}`}</CodeBlock>
      </div>
      <P>
        For a service, build with <code className="font-mono text-text-primary">Analytics::with_options(...)</code>{" "}
        and share it across threads — it&apos;s thread-safe (<code className="font-mono text-text-primary">Arc&lt;Mutex&gt;</code> internally).
      </P>

      <H2>The one rule that travels: flush before you exit</H2>
      <P>
        Every SDK batches events and flushes on a timer. Long-running servers and browser tabs handle
        the last batch for you. But a <strong>short-lived process</strong> — a CLI, a cron job, a
        serverless function — can exit before that timer fires and drop the final events. The fix is
        the same everywhere, just spelled differently:{" "}
        <code className="font-mono text-text-primary">await counted.flush()</code>,{" "}
        <code className="font-mono text-text-primary">analytics.flush()</code>,{" "}
        <code className="font-mono text-text-primary">defer DestroyGlobal()</code>, or letting the
        Rust client drop. It&apos;s the one thing people trip on — so reach for it whenever the process
        is going to end soon.
      </P>

      <H2>Tracking an AI agent</H2>
      <P>
        Agents are just another event source, in any language. For a long-running run, set an explicit
        session id and disable auto-reset so the whole run groups together — then{" "}
        <code className="font-mono text-text-primary">track(&quot;tool_use&quot;, ...)</code> the same
        way you&apos;d track a human action:
      </P>
      <div className="mt-3">
        <CodeBlock>{`# Python
analytics = Analytics(
    project_key="ck_your_project_key",
    session_id="agent-run-123",
    session_timeout=0,   # never auto-reset
)
analytics.track("tool_use", {"tool": "web_search", "outcome": "success"})
analytics.track("task_complete", {"duration_ms": 45000})`}</CodeBlock>
      </div>
      <P>
        Go and Rust take the same <code className="font-mono text-text-primary">SessionID</code> /{" "}
        <code className="font-mono text-text-primary">session_id</code> +{" "}
        <code className="font-mono text-text-primary">SessionTimeout: 0</code> options. From here,
        build the dashboard you want — funnels, retention, per-tool breakdowns — all composable on top
        of the events you send, whatever language sent them.
      </P>
    </PostLayout>
  );
}
