import type { Metadata } from "next";
import { SiteNav, SiteFooter, CodeBlock } from "../../site-chrome";
import { TrackedCTA } from "../../track";

export const metadata: Metadata = {
  title: "Agent analytics & eval — Counted for AI coding agents",
  description:
    "Track what your AI agents do: tool calls, file edits, commands, outcomes — privacy-safe, in a pre-built eval dashboard. Native plugins for Claude Code and OpenCode.",
  alternates: { canonical: "/for/agents" },
  openGraph: {
    title: "Counted for agents — privacy-first agent analytics",
    description:
      "Agent eval dashboards in minutes. Native Claude Code & OpenCode plugins, polyglot SDKs, privacy-safe by default.",
    url: "/for/agents",
    type: "article",
    images: ["/og?title=Analytics%20for%20AI%20agents&eyebrow=For%20agents"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Counted for agents — privacy-first agent analytics",
    description: "Agent eval dashboards in minutes. Native Claude Code & OpenCode plugins, privacy-safe by default.",
    images: ["/og?title=Analytics%20for%20AI%20agents&eyebrow=For%20agents"],
  },
};

export default function ForAgentsPage() {
  return (
    <div>
      <SiteNav />

      <div className="page">
        <h1>See what your agents actually do</h1>
        <p>
          Native plugins for AI coding tools. Capture tool calls, file edits, commands, and
          outcomes in a pre-built eval dashboard. No PII, no code contents.
        </p>
        <p>
          <TrackedCTA href="/login" location="for_agents" label="start_free">
            Start free
          </TrackedCTA>{" "}
          &nbsp;or&nbsp; <a href="/docs">read the docs</a>
        </p>

        <h2>What gets captured</h2>
        <ul>
          <li>
            <b>Tool usage.</b>{" "}Which tools the agent reaches for, how often, and in what order.
          </li>
          <li>
            <b>File edits.</b>{" "}Files touched per session — repo-relative paths only, never
            contents.
          </li>
          <li>
            <b>Commands.</b>{" "}Commands run, recorded by binary name — no arguments, no secrets.
          </li>
          <li>
            <b>Outcomes.</b>{" "}Session starts and ends, and the results you choose to
            tag.
          </li>
        </ul>

        <h2>Install the Claude Code plugin</h2>
        <p>
          Add the marketplace, install, set a key. Every session streams privacy-safe events
          into your eval dashboard.
        </p>
        <CodeBlock>{`/plugin marketplace add iceglober/counted
/plugin install claude-code@counted

# then expose a client key to your sessions
export COUNTED_AGENT_KEY="ck_your_project_key"`}</CodeBlock>
        <p className="small muted">
          Prefer OpenCode?{" "}
          <a href="https://www.npmjs.com/package/@counted/opencode" target="_blank" rel="noopener" className="ext">
            <code>@counted/opencode</code> ships a native plugin too
          </a>
          . Other tools can use the zero-dependency core SDK directly.
        </p>

        <h2>Or instrument it yourself</h2>
        <p>
          Building your own harness? The core SDK is zero-dependency and agent-aware — explicit
          session IDs, configurable session timeout, and an exit handler that flushes before
          short-lived processes die.
        </p>
        <CodeBlock>{`import { Analytics } from "@counted/sdk";

const counted = new Analytics({ projectKey: "ck_...", sessionId: runId });
counted.track("tool_use", { tool: "search", outcome: "hit" });
counted.track("session_end", { duration_ms: elapsed });`}</CodeBlock>
        <p className="small muted">
          Non-JS harness? The HTTP API is one POST per event — Python, Go, and Rust SDKs are
          coming soon (+1 yours in the <a href="/docs#more-sdks">docs</a>).
        </p>

        <h2>Start from the eval template</h2>
        <p>
          New projects can start from the agent-eval dashboard template — tool usage, outcomes,
          file edits, and commands. Compose your own insights on top.
        </p>
        <p>
          <TrackedCTA href="/login" location="for_agents" label="get_eval_dashboard">
            Get your eval dashboard
          </TrackedCTA>
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}
