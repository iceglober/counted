# @counted/agent-telemetry

Agent telemetry for [Counted](https://counted.dev): a shared tracking library and the `counted-agent` hook executable. Native plugins use the same implementation: [Claude Code](../agent-claude-code) and [OpenCode](../agent-opencode).

## Hook CLI

```sh
npm install -g @counted/agent-telemetry
export COUNTED_AGENT_KEY="YOUR_INGEST_KEY"
counted-agent --host generic
```

Point a host hook at this command and pass its event JSON on standard input. The executable keeps its existing `counted-agent` name. Host mappings are selected with `--host claude-code`, `--host codex`, `--host gemini`, or `--host generic`; check the events your host actually supplies. For the native plugin installation paths, use the integration packages linked above.

The process exits successfully on malformed events or unavailable telemetry and has a four-second timeout. With no key it sends nothing; session-start events produce a configuration notice. Setup metadata is cached per host session for hooks that start a separate process for each event.

## Tracking library

```ts
import { createAgentTracker } from "@counted/agent-telemetry";

const tracker = createAgentTracker({
  key: process.env.COUNTED_AGENT_KEY,
  host: "generic",
});
tracker.sessionStart({ mode: "agent" });
tracker.toolUse({ tool: "search", outcome: "success" });
tracker.sessionEnd({});
await tracker.shutdown();
```

Use the host's session ID when it is available to keep related events in the same visit. This grouping is not person identity.

The package also exports host-event mapping, hook handling, setup projection, redaction helpers, and the generated event vocabulary. All integrations share this implementation; batching and delivery use `@counted/sdk`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `COUNTED_AGENT_KEY` | Project ingest key; required to send events. |
| `COUNTED_AGENT_ENDPOINT` | Optional full ingest URL; defaults to `https://api.counted.dev/v1/events`. |
| `COUNTED_SETUP_LABEL` | Optional non-personal label for a configuration. |

The programmatic tracker accepts `endpoint` explicitly; the CLI and native integrations read the endpoint environment variable.

## Event data

The vocabulary includes `agent_session_start`, `agent_session_end`, `agent_tool_use`, `agent_file_edit`, and `agent_command_run`. File paths are made relative, commands are reduced to binary names, and matching credential patterns are scrubbed. Prompt text, file contents, diffs, command arguments, and command output are not transmitted. Avoid personal data in paths, tool names, and configuration labels.

Setup hashes describe configuration changes, not people or devices. Setup context uses `setupHash`, `setupSpec`, and `setupHostSpec`.

## Updating existing integrations

This package combines the former `@counted/agent` and `@counted/agent-core` packages. Replace imports from either name with `@counted/agent-telemetry`; their library exports are available from this one entry point. For CLI installations, replace the npm package while keeping the `counted-agent` command and its arguments.
