import type { Metadata } from "next";
import { Reveal } from "../../reveal";
import { SiteNav, SiteFooter, Eyebrow, CodeBlock, SecondaryCTA } from "../../site-chrome";
import { TrackedCTA } from "../../track";

export const metadata: Metadata = {
  title: "Agent analytics & eval — Counted for AI coding agents",
  description:
    "Track what your AI agents actually do: tool calls, file edits, commands, and outcomes — privacy-safe, in a pre-built eval dashboard. Native plugins for Claude Code and OpenCode, plus zero-dependency SDKs.",
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

const SIGNALS = [
  { title: "Tool usage", body: "Which tools the agent reaches for, how often, and in what order." },
  { title: "File edits", body: "Files touched per session — repo-relative paths only, never contents." },
  { title: "Commands", body: "Commands run, recorded by binary name — no arguments, no secrets." },
  { title: "Outcomes", body: "Session starts and ends, durations, and the results you choose to tag." },
];

export default function ForAgentsPage() {
  return (
    <div className="min-h-screen">
      <SiteNav />

      <section className="px-6 pt-20 pb-12 max-w-3xl mx-auto text-center">
        <Eyebrow>Analytics for AI agents</Eyebrow>
        <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] tracking-tight leading-tight">
          See what your agents
          <br />
          <span className="text-accent">actually do</span>
        </h1>
        <p className="mt-6 text-text-secondary text-lg max-w-xl mx-auto leading-relaxed">
          Counted is built for AI coding tools, with native plugins most analytics platforms
          don&apos;t ship. Capture tool calls, file edits, commands, and outcomes in a pre-built eval
          dashboard — privacy-safe, no PII, no code contents.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <TrackedCTA href="/login" location="for_agents" label="start_free">Start free</TrackedCTA>
          <SecondaryCTA href="/blog/claude-code-eval-in-5-minutes">Track an eval in 5 min</SecondaryCTA>
        </div>
      </section>

      <Reveal>
        <section className="px-6 py-12 border-t border-border">
          <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {SIGNALS.map((s) => (
              <div key={s.title}>
                <h3 className="text-sm font-medium mb-2">{s.title}</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="px-6 py-16 border-t border-border">
          <div className="max-w-2xl mx-auto">
            <Eyebrow>Claude Code plugin</Eyebrow>
            <h2 className="mt-2 font-display text-2xl md:text-3xl tracking-tight">Install the plugin</h2>
            <p className="mt-4 text-text-secondary leading-relaxed">
              Counted ships as a real Claude Code plugin. Add the marketplace, install, and set a
              key — every session then streams privacy-safe events into your eval dashboard.
            </p>
            <div className="mt-6">
              <CodeBlock>{`/plugin marketplace add iceglober/counted
/plugin install claude-code@counted

# then expose a client key to your sessions
export COUNTED_AGENT_KEY="ck_your_project_key"`}</CodeBlock>
            </div>
            <p className="mt-4 text-xs text-text-tertiary">
              Prefer OpenCode?{" "}
              <a href="/blog/opencode-eval-in-5-minutes" className="text-accent hover:text-accent-hover transition-colors">
                <code className="font-mono">@counted/opencode</code> ships a native plugin too
              </a>
              . Other tools can use the zero-dependency core SDK directly.
            </p>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="px-6 py-16 border-t border-border">
          <div className="max-w-2xl mx-auto">
            <Eyebrow>Or instrument it yourself</Eyebrow>
            <h2 className="mt-2 font-display text-2xl md:text-3xl tracking-tight">A few lines in any runtime</h2>
            <p className="mt-4 text-text-secondary leading-relaxed">
              Building your own harness? The core SDK is zero-dependency and agent-aware —
              explicit session IDs, configurable session timeout, and an exit handler that flushes
              before short-lived processes die.
            </p>
            <div className="mt-6">
              <CodeBlock>{`import { Analytics } from "@counted/sdk";

const counted = new Analytics({ projectKey: "ck_...", sessionId: runId });
counted.track("tool_use", { tool: "search", outcome: "hit" });
counted.track("session_end", { duration_ms: elapsed });`}</CodeBlock>
            </div>
            <p className="mt-4 text-xs text-text-tertiary">
              Python, Go, and Rust SDKs offer the same agent-ready API for non-JS harnesses.
            </p>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="px-6 py-16 border-t border-border">
          <div className="max-w-xl mx-auto text-center">
            <h2 className="text-2xl font-display tracking-tight">Built on a pre-made eval template</h2>
            <p className="mt-4 text-text-secondary leading-relaxed">
              New projects can start from the agent-eval dashboard template — tool usage, outcomes,
              file edits, and commands, ready to read. Compose your own insights on top.
            </p>
            <div className="mt-8">
              <TrackedCTA href="/login" location="for_agents" label="get_eval_dashboard">Get your eval dashboard</TrackedCTA>
            </div>
          </div>
        </section>
      </Reveal>

      <SiteFooter />
    </div>
  );
}
