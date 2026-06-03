import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("python-analytics-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        Backends deserve product analytics too. The <code className="font-mono text-text-primary">counted</code> Python
        SDK is zero-dependency and thread-safe, so you can track real events from a service —
        privacy-first, no PII — in about five minutes.
      </Lead>

      <Step n={1} title="Get a project key">
        <P>
          Create a project and copy its <code className="font-mono text-text-primary">ck_</code> client key — or mint one
          with no signup:
        </P>
        <div className="mt-3">
          <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
        </div>
      </Step>

      <Step n={2} title="Install">
        <div className="mt-1">
          <CodeBlock>{`pip install counted`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Initialize and track">
        <P>The simplest path — a module-level client, initialized once at startup:</P>
        <div className="mt-3">
          <CodeBlock>{`import counted

counted.init("ck_your_project_key")

counted.track("user_signup", {"plan": "free"})
counted.track("invoice_paid", {"amount": 29, "currency": "usd"})`}</CodeBlock>
        </div>
        <P>Properties are plain values — strings, numbers, booleans. Don&apos;t send names, emails, or anything that identifies a person.</P>
      </Step>

      <Step n={4} title="Flush cleanly on shutdown">
        <P>
          For a service or a short-lived job, use the class-based client and flush before exit so
          you never lose the last batch:
        </P>
        <div className="mt-3">
          <CodeBlock>{`from counted import Analytics

analytics = Analytics(
    project_key="ck_your_project_key",
    host="https://app.counted.dev",  # or your self-hosted URL
    flush_interval=10.0,
)

analytics.track("job_started", {"queue": "emails"})
# ... do work ...
analytics.track("job_finished", {"processed": 128})

analytics.flush()
analytics.destroy()`}</CodeBlock>
        </div>
      </Step>

      <Step n={5} title="Tracking an AI agent? Use explicit sessions">
        <P>
          For a long-running agent, set an explicit session id and disable auto-reset so a whole
          run groups together:
        </P>
        <div className="mt-3">
          <CodeBlock>{`analytics = Analytics(
    project_key="ck_your_project_key",
    session_id="agent-run-123",
    session_timeout=0,   # never auto-reset
    flush_interval=10.0,
)

analytics.track("tool_use", {"tool": "web_search", "outcome": "success"})
analytics.track("task_complete", {"duration_ms": 45000})`}</CodeBlock>
        </div>
        <P>From here, build the dashboard you want — funnels, retention, per-tool breakdowns — all composable on top of the events you send.</P>
      </Step>
    </PostLayout>
  );
}
