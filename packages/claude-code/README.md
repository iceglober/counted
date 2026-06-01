# @counted/claude-code

Privacy-first analytics for Claude Code hooks. Track AI agent actions without exposing code or content.

## Install

```bash
npm install @counted/claude-code @counted/sdk
```

## Usage

```typescript
import { init, trackToolUse, trackFileEdit, trackCommand, trackSessionStart, trackSessionEnd } from "@counted/claude-code";

// Initialize once
init({ projectKey: "ck_..." });

// Track events
trackSessionStart({ model: "claude-sonnet-4-6", mode: "agent" });
trackToolUse({ tool: "Read", outcome: "success", durationMs: 120 });
trackFileEdit({ filePath: "src/index.ts", action: "edit", language: "typescript" });
trackCommand({ command: "npm test", exitCode: 0, durationMs: 5400 });
trackSessionEnd({ durationMs: 180000, toolUseCount: 42, fileEditCount: 8 });
```

## What it tracks

- **Tool use**: which tool was used, whether it succeeded, how long it took
- **File edits**: which files were created/edited/deleted, what language
- **Commands**: which commands were run, exit codes, duration
- **Sessions**: start/end, model, mode, duration, counts

## What it does NOT track

- File contents or diffs
- Command arguments or output
- Prompt text or AI responses
- Any personally identifiable information

## Session handling

Sessions in agent contexts are different from browser sessions. The SDK is configured with `sessionTimeout: 0` — sessions never auto-reset. You control session boundaries explicitly via `trackSessionStart` / `trackSessionEnd`.

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
`tool_use` outcome, `command_run` exit codes, or `file_edit` volume.

## License

MIT
