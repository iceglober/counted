// Node.js-only graceful-shutdown handlers. Kept in its own module (imported
// dynamically from instrumentation.ts inside the NEXT_RUNTIME==="nodejs" guard)
// so the literal process.once calls never enter the Edge runtime's static
// bundle — otherwise Next flags them as unsupported-Edge-API build warnings.

import { drainBuffer } from "./event-buffer";
import { logError } from "./log";

let registered = false;

export function registerShutdownHandlers(): void {
  if (registered) return;
  registered = true;

  let draining = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (draining) return;
    draining = true;
    try {
      await drainBuffer();
    } catch (err) {
      logError("shutdown_drain_failed", err, { signal });
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
