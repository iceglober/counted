// JS/TS core SDK conformance driver. Run as a subprocess by the orchestrator:
//   COUNTED_KEY=ck_... COUNTED_HOST=http://127.0.0.1:PORT bun js-driver.ts <scenario>
// Each scenario inits the real @counted/sdk Analytics and exercises one behavior.
import { Analytics } from "../../../packages/sdk/src/index";

const scenario = process.argv[2];
const projectKey = process.env.COUNTED_KEY!;
const host = process.env.COUNTED_HOST!;

async function main() {
  if (scenario === "flush") {
    // Explicit session + manual flush -> two events arrive as one batch.
    const a = new Analytics({ projectKey, host, sessionId: "conf-sess", flushInterval: 600_000 });
    a.track("alpha", { n: 1 });
    a.track("beta", { n: 2 });
    await a.flush();
  } else if (scenario === "batch") {
    // Reaching maxBatchSize auto-flushes without a manual call.
    const a = new Analytics({ projectKey, host, maxBatchSize: 3, flushInterval: 600_000 });
    a.track("e1");
    a.track("e2");
    a.track("e3"); // hits the cap -> auto flush
    await a.flush(); // drain any remainder (none expected)
  } else if (scenario === "exit") {
    // Track, then exit WITHOUT flushing — the beforeExit handler must flush.
    const a = new Analytics({ projectKey, host, flushInterval: 600_000 });
    a.track("onexit");
    // No flush(); return and let the process exit naturally.
  } else {
    throw new Error(`unknown scenario: ${scenario}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
