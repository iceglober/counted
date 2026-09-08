/**
 * The binary. Nothing but the process plumbing — see `run.ts` for the logic,
 * which is kept out of here precisely so it can be tested without a process.
 */

import { main } from "./run";

const killer = setTimeout(() => process.exit(0), 4_000);
if (typeof killer.unref === "function") killer.unref();

main(
  {
    env: process.env,
    argv: process.argv.slice(2),
    cwd: () => process.cwd(),
    warn: (message: string) => void process.stderr.write(`counted: ${message}\n`),
  },
  process.stdin,
)
  // Swallowed deliberately, and at the last possible moment: this process runs
  // inside somebody's agent session and must never be why it stops.
  .catch(() => {})
  .finally(() => {
    clearTimeout(killer);
    process.exit(0);
  });
