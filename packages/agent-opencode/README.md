# @counted/opencode

Counted telemetry integration for OpenCode. This is an in-process plugin that receives OpenCode lifecycle and tool callbacks and uses `@counted/agent-telemetry` for tracking and configuration projection.

## Install

Add the package to `opencode.json`:

```json
{ "plugin": ["@counted/opencode"] }
```

Set your Counted project's ingest key before starting OpenCode:

```sh
export COUNTED_AGENT_KEY="YOUR_INGEST_KEY"
# Optional full URL for self-hosted ingestion:
export COUNTED_AGENT_ENDPOINT="https://analytics.example.com/v1/events"
```

Without a key, the plugin sends nothing. It flushes on idle and shutdown and flushes the previous tracker when switching host sessions.

## Events

| OpenCode signal | Counted event |
| --- | --- |
| `session.created` | `agent_session_start` |
| `session.deleted` | `agent_session_end` |
| `tool.execute.after` | `agent_tool_use` with a success outcome |
| Edit/write tool calls | `agent_file_edit` with relative path, action, and language |
| Bash tool calls | `agent_command_run` with the binary name |

Per-tool failure attribution is not implemented; the after-hook reports successful calls. Prompt text, file contents, diffs, command arguments, and output are not transmitted. Avoid personal data in paths, tool names, and labels.

## Compare configurations

The configuration hook supplies the model, tool settings, agent names, and sampling settings used to calculate setup context. Events can carry `setupHash`, `setupSpec`, `setupHostSpec`, and an optional `COUNTED_SETUP_LABEL`. Create Insights over `agent_*` events and group by these properties to compare configurations.

## Custom integrations

The package entry point exports `CountedPlugin` and its default export for the host loader. Build custom tracking with `createAgentTracker` from [`@counted/agent-telemetry`](../agent-telemetry). There is no `@counted/opencode/api` subpath.
