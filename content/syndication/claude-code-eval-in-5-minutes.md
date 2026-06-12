---
title: Track your Claude Code agent eval in 5 minutes
description: Capture tool calls, file edits, commands, and outcomes from Claude Code into a pre-built eval dashboard — privacy-safe.
tags: ai, analytics, devtools, privacy
canonical_url: https://counted.dev/blog/claude-code-eval-in-5-minutes
published: false
---

[Counted](https://counted.dev) captures what Claude Code actually does — tool calls, file edits, commands, outcomes — in a pre-built eval dashboard, privacy-safe by default. Five minutes to set up.

## 1. Create an agent project

Make a project for your agent activity and copy its `ck_` client key. One project per harness keeps the eval dashboards clean.

## 2. Install the Claude Code plugin

Counted ships as a native Claude Code plugin. Add the marketplace and install it:

```
/plugin marketplace add iceglober/counted
/plugin install claude-code@counted
```

## 3. Point it at your project

Expose your client key to your sessions. Until this is set, the plugin is a no-op — it never phones home on its own.

```bash
export COUNTED_AGENT_KEY="ck_your_project_key"
export COUNTED_AGENT_HOST="https://app.counted.dev"
```

## 4. Run a session — the data is privacy-safe

Start working as usual. On `SessionStart`, `PostToolUse`, and `SessionEnd`, the plugin emits events grouped by the Claude session ID. File paths are repo-relative, commands are recorded by binary name only, and no code contents or arguments ever leave your machine.

## 5. Read the eval dashboard

Start the project from the agent-eval template and you get tool usage, outcomes, file edits, and commands out of the box. Compose your own insights on top — slowest tools, edit hotspots, session length over time.

Building your own harness instead of using Claude Code? The same data shape works from the zero-dependency core SDK — explicit session IDs and an exit handler that flushes before short-lived processes die:

```ts
import { Analytics } from "@counted/sdk";

const counted = new Analytics({ projectKey: "ck_...", sessionId: runId });
counted.track("tool_use", { tool: "search", outcome: "hit" });
counted.track("session_end", { duration_ms: elapsed });
```

*Originally published on [counted.dev](https://counted.dev/blog/claude-code-eval-in-5-minutes).*
