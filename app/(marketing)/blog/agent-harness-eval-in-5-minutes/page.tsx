import type { Metadata } from "next";
import { getPost } from "../posts";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("agent-harness-eval-in-5-minutes")!;

export const metadata: Metadata = {
  title: `${meta.title} — Counted`,
  description: meta.description,
  alternates: { canonical: `/blog/${meta.slug}` },
  openGraph: { title: meta.title, description: meta.description, url: `/blog/${meta.slug}`, type: "article" },
};

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        You can&apos;t improve an agent you can&apos;t see. Counted captures what your AI coding
        agent actually does — tool calls, file edits, commands, outcomes — into a pre-built eval
        dashboard, privacy-safe by default. Here&apos;s the five-minute version for Claude Code.
      </Lead>

      <Step n={1} title="Create an agent project">
        <P>
          Make a project for your agent activity and copy its{" "}
          <code className="font-mono text-text-primary">ck_</code> client key. One project per
          harness keeps the eval dashboards clean.
        </P>
      </Step>

      <Step n={2} title="Install the Claude Code plugin">
        <P>Counted ships as a native Claude Code plugin. Add the marketplace and install it:</P>
        <div className="mt-3">
          <CodeBlock>{`/plugin marketplace add iceglober/counted
/plugin install claude-code@counted`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Point it at your project">
        <P>
          Expose your client key to your sessions. Until this is set, the plugin is a no-op — it
          never phones home on its own.
        </P>
        <div className="mt-3">
          <CodeBlock>{`export COUNTED_AGENT_KEY="ck_your_project_key"
export COUNTED_AGENT_HOST="https://app.counted.dev"`}</CodeBlock>
        </div>
      </Step>

      <Step n={4} title="Run a session — the data is privacy-safe">
        <P>
          Start working as usual. On <code className="font-mono text-text-primary">SessionStart</code>,{" "}
          <code className="font-mono text-text-primary">PostToolUse</code>, and{" "}
          <code className="font-mono text-text-primary">SessionEnd</code>, the plugin emits events
          grouped by the Claude session ID. File paths are repo-relative, commands are recorded by
          binary name only, and no code contents or arguments ever leave your machine.
        </P>
      </Step>

      <Step n={5} title="Read the eval dashboard">
        <P>
          Start the project from the agent-eval template and you get tool usage, outcomes, file
          edits, and commands out of the box. Compose your own insights on top — slowest tools,
          edit hotspots, session length over time.
        </P>
      </Step>

      <P>
        Building your own harness instead of using Claude Code? The same data shape works from the
        zero-dependency core SDK — explicit session IDs and an exit handler that flushes before
        short-lived processes die:
      </P>
      <div className="mt-3">
        <CodeBlock>{`import { Analytics } from "@counted/sdk";

const counted = new Analytics({ projectKey: "ck_...", sessionId: runId });
counted.track("tool_use", { tool: "search", outcome: "hit" });
counted.track("session_end", { duration_ms: elapsed });`}</CodeBlock>
      </div>
    </PostLayout>
  );
}
