# @counted/gemini-cli

Privacy-first analytics helpers for [Counted](https://counted.dev), sized for
Gemini CLI agent sessions. Track what an agent does — tool use, file edits,
commands, session boundaries — without ever sending code, content, or PII.

> **Status: thin wrapper, not a native plugin yet.** This package is a small
> typed helper API over [`@counted/sdk`](https://www.npmjs.com/package/@counted/sdk)
> (explicit session ids, `sessionTimeout: 0`, flush-on-exit). A **native Gemini
> CLI integration is coming**; until then you wire the calls into your own
> harness. If you want a drop-in plugin today, use
> [`@counted/claude-code`](https://www.npmjs.com/package/@counted/claude-code)
> or [`@counted/opencode`](https://www.npmjs.com/package/@counted/opencode).

## Install

```bash
npm install @counted/gemini-cli @counted/sdk
```

## Usage

```typescript
import { init, trackSessionStart, trackToolUse, trackFileEdit, trackCommand, trackSessionEnd } from "@counted/gemini-cli";

init({ projectKey: "ck_...", sessionId: runId });

trackSessionStart({ model: "gemini-2.5-pro", mode: "agent" });
trackToolUse({ tool: "search", outcome: "success" });
trackFileEdit({ filePath: "src/index.ts", action: "edit", language: "typescript" });
trackCommand({ command: "npm", exitCode: 0 });
trackSessionEnd({});
```

## Privacy

- File **paths** only (keep them repo-relative), never contents or diffs.
- Command **binary name** only — no arguments, no output.
- No prompt text, no AI responses, no PII.

## License

MIT
