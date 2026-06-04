import { Fragment } from "react";
import { CodeBlock } from "../site-chrome";
import { PostLayout, Lead, P, Step } from "./post-layout";
import type { PostMeta } from "./posts";

// Shared body for the per-tool "track your agent eval in 5 minutes" posts. The
// 5-step shape is identical across tools (create project → install → point key →
// run → read dashboard); only the install steps and the signal names differ.
// Add a new tool by adding a config object and a thin route page — same SEO win
// per tool (claude code eval / opencode eval / …) without duplicating prose.

export type AgentTool = {
  name: string;
  lead: string;
  installTitle: string;
  install: { text: string; code: string }[];
  signals: string;
};

export const CLAUDE_CODE: AgentTool = {
  name: "Claude Code",
  lead:
    "Counted captures what Claude Code actually does — tool calls, file edits, commands, outcomes — in a pre-built eval dashboard, privacy-safe by default. Five minutes to set up.",
  installTitle: "Install the Claude Code plugin",
  install: [
    {
      text: "Counted ships as a native Claude Code plugin. Add the marketplace and install it:",
      code: `/plugin marketplace add iceglober/counted
/plugin install claude-code@counted`,
    },
  ],
  signals:
    "Start working as usual. On SessionStart, PostToolUse, and SessionEnd, the plugin emits events grouped by the Claude session ID. File paths are repo-relative, commands are recorded by binary name only, and no code contents or arguments ever leave your machine.",
};

export const OPENCODE: AgentTool = {
  name: "OpenCode",
  lead:
    "Counted captures what OpenCode actually does — tool calls, file edits, commands, outcomes — in a pre-built eval dashboard, privacy-safe by default. Five minutes to set up.",
  installTitle: "Add the OpenCode plugin",
  install: [
    {
      text: "Add Counted to your opencode.json plugin array — OpenCode auto-installs it:",
      code: `{
  "plugin": ["@counted/opencode"]
}`,
    },
    {
      text: "Prefer a plugins file? Re-export it in .opencode/plugins/counted.ts (project) or ~/.config/opencode/plugins/counted.ts (global):",
      code: `export { CountedPlugin } from "@counted/opencode";`,
    },
  ],
  signals:
    "Start working as usual. Counted hooks OpenCode's plugin events — session.created → session_start, every tool.execute.after → tool_use, edits and writes → file_edit, bash → command_run — through one long-lived, batched SDK instance. File paths are repo-relative, commands are binary-name only, and no code, content, or PII leaves the machine.",
};

export function AgentEvalPost({ meta, tool }: { meta: PostMeta; tool: AgentTool }) {
  return (
    <PostLayout meta={meta}>
      <Lead>{tool.lead}</Lead>

      <Step n={1} title="Create an agent project">
        <P>
          Make a project for your agent activity and copy its{" "}
          <code className="font-mono text-text-primary">ck_</code> client key. One project per
          harness keeps the eval dashboards clean.
        </P>
      </Step>

      <Step n={2} title={tool.installTitle}>
        {tool.install.map((block, i) => (
          <Fragment key={i}>
            <P>{block.text}</P>
            <div className="mt-3">
              <CodeBlock>{block.code}</CodeBlock>
            </div>
          </Fragment>
        ))}
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
        <P>{tool.signals}</P>
      </Step>

      <Step n={5} title="Read the eval dashboard">
        <P>
          Start the project from the agent-eval template and you get tool usage, outcomes, file
          edits, and commands out of the box. Compose your own insights on top — slowest tools,
          edit hotspots, session length over time.
        </P>
      </Step>

      <P>
        Building your own harness instead of using {tool.name}? The same data shape works from the
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
