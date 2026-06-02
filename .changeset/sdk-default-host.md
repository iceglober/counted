---
"@counted/sdk": patch
"@counted/react": patch
"@counted/claude-code": patch
"@counted/opencode": patch
---

Default host now points to `https://app.counted.dev`. The previous default,
`https://counted.dev`, is the apex domain which has no DNS, so events from any
client that didn't pass an explicit `host` were silently dropped. Packages that
bundle the SDK (`react`, `claude-code`, `opencode`) are republished so their
built output picks up the corrected default.
