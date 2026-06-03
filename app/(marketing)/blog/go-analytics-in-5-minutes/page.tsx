import type { Metadata } from "next";
import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("go-analytics-in-5-minutes")!;

export const metadata: Metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        Go services deserve product analytics too. The <code className="font-mono text-text-primary">counted</code> Go
        SDK is zero-dependency and goroutine-safe, so you can track real events from a service —
        privacy-first, no PII — in about five minutes.
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

      <Step n={2} title="Install">
        <div className="mt-1">
          <CodeBlock>{`go get github.com/iceglober/counted/packages/go`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Initialize and track">
        <P>The simplest path — a global client, initialized once at startup, flushed on shutdown.</P>
        <div className="mt-3">
          <CodeBlock>{`package main

import counted "github.com/iceglober/counted/packages/go"

func main() {
    counted.Init(counted.Options{ProjectKey: "ck_your_project_key"})
    defer counted.DestroyGlobal() // flush before exit

    counted.TrackEvent("user_signup", counted.EventProperties{"plan": "free"})
    counted.TrackEvent("invoice_paid", counted.EventProperties{"amount": 29, "currency": "usd"})
}`}</CodeBlock>
        </div>
        <P>Properties are plain values — strings, numbers, booleans. Don&apos;t send names, emails, or anything that identifies a person.</P>
      </Step>

      <Step n={4} title="Use an instance in a service">
        <P>
          For a long-running service, create a client with the options you want and keep it around —
          it&apos;s goroutine-safe, so share it across handlers:
        </P>
        <div className="mt-3">
          <CodeBlock>{`analytics := counted.New(counted.Options{
    ProjectKey:    "ck_your_project_key",
    Host:          "https://app.counted.dev", // or your self-hosted URL
    FlushInterval: 10 * time.Second,
})
defer analytics.Destroy() // flush + stop on shutdown

analytics.Track("job_finished", counted.EventProperties{"processed": 128})`}</CodeBlock>
        </div>
      </Step>

      <Step n={5} title="Tracking an AI agent? Use explicit sessions">
        <P>
          For a long-running agent, set an explicit session id and disable auto-reset so a whole
          run groups together:
        </P>
        <div className="mt-3">
          <CodeBlock>{`analytics := counted.New(counted.Options{
    ProjectKey:     "ck_your_project_key",
    SessionID:      runID,
    SessionTimeout: 0, // never auto-reset
    FlushInterval:  10 * time.Second,
})

analytics.Track("tool_use", counted.EventProperties{"tool": "web_search", "outcome": "success"})
analytics.Track("task_complete", counted.EventProperties{"duration_ms": 45000})`}</CodeBlock>
        </div>
        <P>From here, build the dashboard you want — funnels, retention, per-tool breakdowns — all composable on top of the events you send.</P>
      </Step>
    </PostLayout>
  );
}
