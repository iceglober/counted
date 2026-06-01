# Agent dogfooding — Claude Code → Counted

These hooks send privacy-safe analytics about agent dev sessions on this repo
into a Counted **agent-eval** dashboard. They battle-test `@counted/claude-code`
(and the JS core SDK's short-lived-process exit flush) on real traffic.

`counted-hook.mjs` is the bridge: Claude Code runs it per hook event
(`SessionStart`, `PostToolUse`, `SessionEnd` — wired in `../settings.json`), it
reads the event JSON on stdin and forwards one event via the in-repo
`@counted/claude-code` package.

## Activation

The hooks are a **no-op until `COUNTED_AGENT_KEY` is set** — committing them is
safe and they do nothing without a key.

To turn them on, export the agent project's **client** key (`ck_…`) in your
environment (e.g. shell profile):

```bash
export COUNTED_AGENT_KEY="ck_your_agent_project_client_key"
# Optional — defaults to https://app.counted.dev
export COUNTED_AGENT_HOST="https://app.counted.dev"
```

Create the project in Counted with the **agent** dashboard template so the
pre-built tool-usage / outcomes / file-edit / command insights line up with the
events below.

## Events

| Hook | Counted event | Props |
| --- | --- | --- |
| `SessionStart` | `session_start` | `model`, `mode` (startup/resume/clear/compact) |
| `PostToolUse` (any) | `tool_use` | `tool`, `outcome` (success/error from `did_succeed`) |
| `PostToolUse` (Write/Edit/MultiEdit) | `file_edit` | `filePath` (repo-relative), `action`, `language` |
| `PostToolUse` (Bash) | `command_run` | `command` (binary name only), `exitCode` |
| `SessionEnd` | `session_end` | — |

All events carry the Claude `session_id` as the Counted session id, so one
agent session groups together.

## Privacy

Mirrors `@counted/claude-code`'s stance — **no content ever leaves the machine**:
- File **paths** only (repo-relative; basename fallback so home dirs never leak), never contents or diffs.
- Command **binary name** only (`git`, `bun`, …) — no arguments, no output.
- No prompt text, no AI responses, no PII.

## Safety

The bridge can never block or break a session: every error is swallowed, it
always exits 0, and a hard self-timeout (4s) guards against a slow network.
`PostToolUse` is registered `async` so it never adds latency to a tool call.
