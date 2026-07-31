/**
 * The Claude Code hook.
 *
 * Claude Code runs this once per hook event with the event JSON on stdin (see
 * `hooks/hooks.json`), so it is a process per event — which is why the setup
 * fingerprint is cached to a temp file and why nothing here batches.
 *
 * The whole body is `@counted/agent`, with the host fixed. This package exists
 * for what it *ships*, not what it computes: the plugin manifest, the hook
 * registrations, and a bundled binary that runs where there is no
 * `node_modules`. That is the test the design applies to a host package — a
 * real, installable integration point — and it is the test `codex-cli` and
 * `gemini-cli` failed.
 */

import { main } from "@counted/agent";

const killer = setTimeout(() => process.exit(0), 4_000);
if (typeof killer.unref === "function") killer.unref();

main(
  {
    env: process.env,
    argv: ["--host", "claude-code"],
    cwd: () => process.cwd(),
    warn: (message: string) => void process.stderr.write(`counted: ${message}\n`),
  },
  process.stdin,
)
  .catch(() => {})
  .finally(() => {
    clearTimeout(killer);
    process.exit(0);
  });
