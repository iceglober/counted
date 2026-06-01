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

## License

MIT
