import type { Metadata } from "next";
import { SiteArticle, CodeBlock } from "../../../../components/site-chrome";
export const metadata: Metadata = { title: "Analytics for AI coding agents", alternates: { canonical: "/for/agents" }, description: "Track tool usage, file edits, commands, and outcomes without sending prompts or code contents." };
export default function Agents() { return <SiteArticle eyebrow="Counted for agents" title="See what your agents actually do"><p>Capture tool calls, file edits, commands, and outcomes with the same event model you use for your app.</p><h2>Shape, never content</h2><ul><li><strong>Tool usage:</strong> tool names and reported outcomes.</li><li><strong>File edits:</strong> repo-relative paths, actions, and language. Never contents or diffs.</li><li><strong>Commands:</strong> binary names, without arguments or output.</li><li><strong>Session boundaries:</strong> starts and ends reported by your host.</li></ul><p>Inspect the properties your integration sends and avoid personal data in paths or labels. Available events and outcomes depend on the host’s hooks.</p><h2>Connect a host</h2><p>Use <code>@counted/claude-code</code> or <code>@counted/opencode</code> for native integrations. The <code>@counted/agent</code> CLI accepts host events over standard input.</p><CodeBlock>{`npm install -g @counted/agent
export COUNTED_AGENT_KEY="YOUR_INGEST_KEY"

# Configure your host to pipe hook events to this command:
counted-agent --host codex`}</CodeBlock><p>See the <a href="https://github.com/iceglober/counted/tree/main/packages/agent-cli">CLI instructions</a> and the <a href="https://github.com/iceglober/counted/tree/main/packages/agent-claude-code">Claude Code</a> and <a href="https://github.com/iceglober/counted/tree/main/packages/agent-opencode">OpenCode</a> integrations for host-specific setup.</p><h2>Instrument your own harness</h2><CodeBlock>{`import { Counted } from "@counted/sdk";

const counted = new Counted({ key: "YOUR_INGEST_KEY" });
counted.track("tool_use", { tool: "search", outcome: "success" });
await counted.shutdown();`}</CodeBlock><p>Create a dashboard and add Insights for tool counts, trends, or breakdowns by tool and outcome. For automated setup and queries, use the <a href="/docs">API</a> or <a href="/llms.txt">agent discovery guide</a>.</p></SiteArticle>; }
