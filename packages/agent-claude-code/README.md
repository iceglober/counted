# @counted/claude-code

Counted telemetry integration for Claude Code. This package supplies the plugin manifest, hook registrations, and a bundled executable. Tracking and host-event handling come from `@counted/agent-telemetry`.

## Install

Inside Claude Code:

```text
/plugin marketplace add iceglober/counted
/plugin install claude-code@counted
```

Set your Counted project's ingest key in the environment before starting Claude Code:

```sh
export COUNTED_AGENT_KEY="YOUR_INGEST_KEY"
# Optional full URL for self-hosted ingestion:
export COUNTED_AGENT_ENDPOINT="https://analytics.example.com/v1/events"
```

Without a key, the hook sends nothing. A session-start notice explains how to configure it. Each hook process has a four-second timeout and exits successfully even when telemetry cannot be delivered.

## Events

| Host hook | Counted event |
| --- | --- |
| `SessionStart` | `agent_session_start` |
| `PostToolUse` | `agent_tool_use` with a success outcome |
| `PostToolUseFailure` | `agent_tool_use` with an error outcome |
| Write/Edit tool calls | `agent_file_edit` with relative path, action, and language |
| Bash tool calls | `agent_command_run` with the binary name |
| `SessionEnd` | `agent_session_end` |

Prompt text, file contents, diffs, command arguments, and output are not transmitted. Avoid personal data in paths and configuration labels.

## Compare configurations

Setup context carries `setupHash`, `setupSpec`, `setupHostSpec`, and the model when the host supplies it. `COUNTED_SETUP_LABEL` adds an optional non-personal label. Build an Insight over the `agent_*` events and group by a setup property to compare configurations.

## Custom hooks

For direct tracking, import `createAgentTracker` from [`@counted/agent-telemetry`](../agent-telemetry). This package retains its `handle` and `HOSTS` exports for custom hook callers; it does not provide the retired `init` or `trackToolUse` APIs.
