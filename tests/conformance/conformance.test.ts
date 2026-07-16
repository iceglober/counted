import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { startCaptureServer, type CaptureServer } from "./capture-server";
import { join } from "node:path";

// SDK conformance: every SDK must satisfy the same POST /api/v0/event wire
// contract. Each language ships a tiny driver that inits the SDK and runs one
// scenario against an ephemeral capture server; we assert the captured payloads.

const KEY = "ck_conformance_test_key";
// Generous: a compiled driver (Rust/Go) may build on first invocation.
const TEST_TIMEOUT = 180_000;
const ROOT = join(import.meta.dir, "..", "..");
const driver = (f: string) => join(import.meta.dir, "drivers", f);

type Driver = {
  name: string;
  sdkVersion: string;
  available: boolean;
  cmd: (scenario: string) => string[];
  cwd?: string;
  // Go has no automatic exit handler — its driver flushes via Destroy() instead.
  // Documented so a reader knows the "exit" scenario still asserts delivery.
  exitFlushesAutomatically?: boolean;
};

const has = (bin: string) => Bun.which(bin) !== null;

const DRIVERS: Driver[] = [
  {
    name: "js",
    sdkVersion: "counted/0.1.1",
    available: has("bun"),
    cmd: (s) => ["bun", driver("js-driver.ts"), s],
  },
  {
    name: "python",
    sdkVersion: "counted-python/0.1.0",
    available: has("python3"),
    cmd: (s) => ["python3", driver("py-driver.py"), s],
  },
  {
    name: "rust",
    sdkVersion: "counted-rust/0.1.0",
    available: has("cargo"),
    cwd: join(ROOT, "packages", "rust"),
    cmd: (s) => ["cargo", "run", "-q", "--example", "conformance", "--", s],
  },
  {
    name: "go",
    sdkVersion: "counted-go/0.1.0",
    available: has("go"), // skipped where the Go toolchain is absent (e.g. local dev)
    cwd: join(import.meta.dir, "drivers", "go-driver"),
    cmd: (s) => ["go", "run", ".", s],
    exitFlushesAutomatically: false, // Go uses Destroy() to flush on shutdown
  },
];

let server: CaptureServer;
beforeAll(async () => {
  server = await startCaptureServer();
});
afterAll(async () => {
  await server?.stop();
});
beforeEach(() => server.reset());

async function runDriver(d: Driver, scenario: string) {
  const proc = Bun.spawn({
    cmd: d.cmd(scenario),
    cwd: d.cwd ?? ROOT,
    env: { ...process.env, COUNTED_KEY: KEY, COUNTED_HOST: server.url },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  if (exit !== 0) {
    throw new Error(`${d.name} driver (${scenario}) exited ${exit}:\n${stderr}`);
  }
}

// Poll the in-process capture server until it has the expected event count.
async function waitForEvents(expected: number, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (server.events().length >= expected) return;
    await Bun.sleep(25);
  }
}

for (const d of DRIVERS) {
  describe(`${d.name} SDK`, () => {
    test.skipIf(!d.available)("shape + session + flush (manual flush, explicit session)", async () => {
      await runDriver(d, "flush");
      await waitForEvents(2);

      const events = server.events();
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.eventName).sort()).toEqual(["alpha", "beta"]);

      for (const e of events) {
        expect(e.sessionId).toBe("conf-sess"); // explicit session honored verbatim
        expect(typeof e.timestamp).toBe("string");
        // Assert the SDK identifies itself with the right name prefix; the exact
        // version varies by build (source run = 0.0.0-dev, released dist = real).
        expect(e.systemProps?.sdkVersion?.startsWith(d.sdkVersion.split("/")[0] + "/")).toBe(true);
        expect(typeof e.props).toBe("object");
      }
      // Props round-trip with the right event.
      expect(server.events().find((e) => e.eventName === "alpha")?.props).toMatchObject({ n: 1 });

      // The auth header reached the server.
      expect(server.requests().every((r) => r.projectKey === KEY)).toBe(true);
      // Two events went out as a single JSON array (a batch), not two requests.
      const batched = server.requests().find((r) => r.count === 2);
      expect(batched?.wasArray).toBe(true);
    }, TEST_TIMEOUT);

    test.skipIf(!d.available)("size-based batching auto-flushes at maxBatchSize", async () => {
      await runDriver(d, "batch");
      await waitForEvents(3);

      const events = server.events();
      expect(events).toHaveLength(3);
      expect(events.map((e) => e.eventName).sort()).toEqual(["e1", "e2", "e3"]);

      // Same auto-generated session across the batch, in the documented format.
      const sessions = new Set(events.map((e) => String(e.sessionId)));
      expect(sessions.size).toBe(1);
      expect(String(events[0].sessionId)).toMatch(/^\d+\.[\w-]+$/);

      // Hitting the cap sent a 3-event array without a manual flush.
      const batch = server.requests().find((r) => r.count === 3);
      expect(batch?.wasArray).toBe(true);
    }, TEST_TIMEOUT);

    test.skipIf(!d.available)("exit handler flushes pending events", async () => {
      await runDriver(d, "exit");
      await waitForEvents(1);

      const events = server.events();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("onexit");
      expect(events[0].systemProps?.sdkVersion?.startsWith(d.sdkVersion.split("/")[0] + "/")).toBe(true);
    }, TEST_TIMEOUT);
  });
}
