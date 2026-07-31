# @counted/agent

`counted-agent` — one hook binary for every agent host that speaks stdin.

Reports **shape, never content**: which tool, which outcome, which file, which
command. Never a diff, never an argument list, never output. File paths are made
repo-relative, commands are reduced to the binary name, and anything matching a
credential pattern is redacted before it is sent.

## Install

```sh
npm i -g @counted/agent
export COUNTED_AGENT_KEY=ck_live_...
```

Then point your host's hook mechanism at it, passing the event JSON on stdin:

```sh
counted-agent --host codex     # Codex CLI
counted-agent --host gemini    # Gemini CLI
counted-agent --host generic   # anything else that emits a JSON event
```

Claude Code and OpenCode have installable plugins instead —
[`@counted/claude-code`](../agent-claude-code) and
[`@counted/opencode`](../agent-opencode).

## Behaviour

- **No key, no output.** Not an error. Said once, on the first event of a
  session, so the silence is diagnosable.
- **Always exits 0**, with a hard 4-second self-timeout. A telemetry hook must
  never be the reason an agent session stalls or dies.
- **One setup fingerprint per session**, cached to a temp file — hooks are a
  process per event, and only the first can see the model.

## Environment

| Variable | Meaning |
|---|---|
| `COUNTED_AGENT_KEY` | Your ingest key. Without it, nothing happens. |
| `COUNTED_AGENT_ENDPOINT` | Override the ingest endpoint (self-hosting). |
| `COUNTED_SETUP_LABEL` | A human name for this setup, to group by. |
