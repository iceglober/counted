# @counted/claude-code

Privacy-first analytics for [Claude Code](https://claude.com/claude-code) —
track what your agent sessions actually do (tool use, file edits, commands,
session boundaries) without ever exposing code, content, or PII.

## Install (zero code)

The fastest path is the Claude Code plugin. From inside Claude Code:

```
/plugin marketplace add iceglober/counted
/plugin install claude-code@counted
```

When prompted, paste your project's **client** key (`ck_...`) — find it in your
Counted project settings. That's it: every session streams privacy-safe events
into your dashboard. Create the project with the **agent** dashboard template so
the pre-built insights line up.

You can also set the key via the environment instead of the plugin prompt:

```bash
export COUNTED_AGENT_KEY="ck_your_project_client_key"
# Optional — defaults to https://app.counted.dev
export COUNTED_AGENT_HOST="https://app.counted.dev"
```

The hook is a **no-op until a key is configured** (a one-line notice prints on
`SessionStart` if none is found), and it never blocks or breaks a session.

## What it tracks

| Claude Code hook | Counted event | Props |
| --- | --- | --- |
| `SessionStart` | `session_start` | `model`, `mode` |
| `PostToolUse` (success) | `tool_use` | `tool`, `outcome: "success"` |
| `PostToolUseFailure` | `tool_use` | `tool`, `outcome: "error"` |
| `PostToolUse` (Write/Edit) | `file_edit` | `filePath` (repo-relative), `action`, `language` |
| `PostToolUse` (Bash) | `command_run` | `command` (binary name only) |
| `SessionEnd` | `session_end` | — |

## What it does NOT track

- File contents or diffs
- Command arguments or output
- Prompt text or AI responses
- Any personally identifiable information

## Compare agent setups

Every event carries a **setup fingerprint** so you can break metrics down by
agentic configuration ("setup A errors 2× more than setup B"):

- `setupHash` — a stable digest of your setup: model, prompts (`CLAUDE.md`,
  `.claude/agents/*`), and tools/permissions (`.claude/settings.json`,
  `permission_mode`). Only the **digest** is sent — prompt content never leaves
  the machine. `setupHashVersion` tracks the scheme.
- `model` — sent in the clear (low-sensitivity), so breakdowns are readable.
- `setupLabel` — optional human bucket; set `COUNTED_SETUP_LABEL="reviewer-v2"`.

In Counted, add a breakdown insight grouped by `setupHash` (or `setupLabel`) over
`tool_use` outcome, `command_run` volume, or `file_edit` volume.

## Advanced — build your own hook

Prefer to wire the events yourself (a custom hook script, or a different agent
harness)? The package exports a small manual API over `@counted/sdk`:

```bash
npm install @counted/claude-code @counted/sdk
```

```typescript
import { init, trackToolUse, trackFileEdit, trackCommand, trackSessionStart, trackSessionEnd } from "@counted/claude-code";

// Initialize once
init({ projectKey: "ck_..." });

// Track events
trackSessionStart({ model: "claude-sonnet-4-6", mode: "agent" });
trackToolUse({ tool: "Read", outcome: "success" });
trackFileEdit({ filePath: "src/index.ts", action: "edit", language: "typescript" });
trackCommand({ command: "npm", exitCode: 0 });
trackSessionEnd({});
```

Sessions in agent contexts differ from browser sessions: the SDK is configured
with `sessionTimeout: 0` — sessions never auto-reset. You control session
boundaries explicitly via `trackSessionStart` / `trackSessionEnd`.

## License

MIT
