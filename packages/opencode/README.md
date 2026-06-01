# @counted/opencode

Native [OpenCode](https://opencode.ai) plugin for [Counted](https://counted.dev) —
privacy-first analytics for AI agent dev sessions. No code, content, or PII ever
leaves the machine.

## Install

Add it to your `opencode.json` `plugin` array (OpenCode auto-installs it):

```json
{
  "plugin": ["@counted/opencode"]
}
```

Or drop a re-export in `.opencode/plugins/counted.ts` (project) or
`~/.config/opencode/plugins/counted.ts` (global):

```ts
export { CountedPlugin } from "@counted/opencode";
```

Then set your project's **client** key in the environment:

```bash
export COUNTED_AGENT_KEY="ck_your_agent_project_client_key"
# Optional — defaults to https://app.counted.dev
export COUNTED_AGENT_HOST="https://app.counted.dev"
```

The plugin is a **no-op until `COUNTED_AGENT_KEY` is set**. Create the project
with the **agent** dashboard template so the pre-built insights line up.

## What it tracks

| OpenCode signal | Counted event | Props |
| --- | --- | --- |
| `session.created` | `session_start` | `mode` |
| `tool.execute.after` (any) | `tool_use` | `tool`, `outcome` |
| `tool.execute.after` (edit/write) | `file_edit` | `filePath` (repo-relative), `action`, `language` |
| `tool.execute.after` (bash) | `command_run` | `command` (binary name only) |
| `session.idle` / `dispose` | — (flush) | — |

Events run through a single long-lived `@counted/sdk` `Analytics` instance
(batched, flushed on idle and on dispose).

## Privacy

- File **paths** only (repo-relative; basename fallback), never contents or diffs.
- Command **binary name** only (`git`, `bun`, …) — no arguments, no output.
- No prompt text, no AI responses, no PII.

OpenCode surfaces tool failures on the event stream rather than the after-hook,
so per-tool `outcome` is currently always `success`; failures aren't attributed
to a specific tool yet.

## Advanced

The package also exports the low-level helpers (`init`, `track`, `trackToolUse`,
…) if you want to emit events from your own OpenCode plugin instead of using
`CountedPlugin` directly.

## License

MIT
