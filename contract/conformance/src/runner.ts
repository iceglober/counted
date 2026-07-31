/**
 * The runner.
 *
 * Drives an SDK through a scenario with a virtual clock and a scripted server,
 * then reports the first divergence. Nothing here knows about JavaScript
 * specifically — the same scenario files drive the Go, Python and Rust drivers
 * through their own harnesses, which is the entire point.
 */

import { parseDuration, type Scenario, type Step } from "./scenario";

export type CapturedRequest = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: { events: Record<string, unknown>[] };
};

/** What a driver must provide. Deliberately tiny. */
export type Driver = {
  track(name: string, properties?: Record<string, unknown>): void;
  identify(userId: string): void;
  reset(): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
};

export type Harness = {
  readonly driver: Driver;
  /** Move the virtual clock and let any resulting work settle. */
  advance(ms: number): Promise<void>;
  /** Requests captured since the last drain. */
  drain(): readonly CapturedRequest[];
  /** Answer the request currently waiting. */
  enqueueResponse(response: { status: number; headers?: Record<string, string>; body?: unknown } | "network-error"): void;
  /**
   * Let work already started finish, without starting any more.
   *
   * Distinct from `advance(0)`, which drives a flush — using that here would
   * hide a retry the SDK made on its own by folding it into the settle.
   */
  settle(): Promise<void>;
};

export type Failure = { readonly step: number; readonly detail: string };

const read = (source: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);

export const runScenario = async (scenario: Scenario, harness: Harness): Promise<readonly Failure[]> => {
  const failures: Failure[] = [];
  const checkpoints = new Map<string, unknown>();
  let latest: CapturedRequest | null = null;

  const fail = (step: number, detail: string): void => void failures.push({ step, detail });

  for (const [index, step] of scenario.script.entries()) {
    if ("do" in step) {
      switch (step.do) {
        case "track":
          harness.driver.track(step.name, step.properties);
          break;
        case "identify":
          harness.driver.identify(step.userId);
          break;
        case "reset":
          harness.driver.reset();
          break;
        case "flush":
          await harness.driver.flush();
          break;
        case "shutdown":
          await harness.driver.shutdown();
          break;
      }
      continue;
    }

    if ("advance" in step) {
      await harness.advance(parseDuration(step.advance));
      continue;
    }

    if ("respond" in step) {
      try {
        harness.enqueueResponse(step.respond);
      } catch (error) {
        fail(index, error instanceof Error ? error.message : "respond failed");
        continue;
      }
      // Let the SDK act on the answer — requeue it, pause, or settle it —
      // before the next step asks what the state is. Deliberately not a
      // flush: a request the SDK makes by itself must stay visible.
      await harness.settle();
      continue;
    }

    // A bare checkpoint, not a `same-as` — which carries a `checkpoint`
    // property too. Testing only for that property matched both, so every
    // `same-as` silently became a checkpoint overwrite and its comparison
    // never ran. The idempotency-key assertions were dead in all four
    // languages until a mutation test showed a re-stamped key passing.
    if ("checkpoint" in step && !("expect" in step)) {
      // Records the whole first event, so a later `same-as` can compare any
      // field of it — which is how "the retry reused the id" is expressed.
      checkpoints.set(step.checkpoint, latest?.body.events[0] ?? null);
      continue;
    }

    // Settle before every assertion. In-process this is a few turns of the
    // event loop; across a pipe it is what pulls the driver's captured
    // requests over. Without it a process driver would always look idle.
    await harness.settle();

    if (step.expect === "request") {
      const requests = harness.drain();
      if (requests.length === 0) {
        fail(index, `expected a request carrying [${step.events.join(", ")}], none was made`);
        continue;
      }
      latest = requests[requests.length - 1]!;
      const names = latest.body.events.map((e) => String(e["name"]));
      if (names.join("|") !== step.events.join("|")) {
        fail(index, `expected events [${step.events.join(", ")}], got [${names.join(", ")}]`);
      }
      continue;
    }

    if (step.expect === "no-request") {
      const requests = harness.drain();
      if (requests.length > 0) {
        const names = requests.flatMap((r) => r.body.events.map((e) => String(e["name"])));
        fail(index, `expected no request, got ${requests.length} carrying [${names.join(", ")}]`);
      }
      continue;
    }

    if (step.expect === "field") {
      const actual = latest === null ? undefined : read(latest.body.events[0] ?? {}, step.path);
      if (JSON.stringify(actual) !== JSON.stringify(step.equals)) {
        fail(index, `expected ${step.path} to be ${JSON.stringify(step.equals)}, got ${JSON.stringify(actual)}`);
      }
      continue;
    }

    if (step.expect === "field-absent") {
      const actual = latest === null ? undefined : read(latest.body.events[0] ?? {}, step.path);
      if (actual !== undefined) {
        fail(index, `expected ${step.path} to be absent, got ${JSON.stringify(actual)}`);
      }
      continue;
    }

    if (step.expect === "same-as") {
      const saved = checkpoints.get(step.checkpoint);
      if (saved === undefined) {
        fail(index, `no checkpoint named ${step.checkpoint}`);
        continue;
      }
      const before = read((saved ?? {}) as Record<string, unknown>, step.path);
      const now = latest === null ? undefined : read(latest.body.events[0] ?? {}, step.path);
      if (JSON.stringify(before) !== JSON.stringify(now)) {
        fail(index, `expected ${step.path} to match checkpoint ${step.checkpoint}: ${JSON.stringify(before)} became ${JSON.stringify(now)}`);
      }
    }
  }

  return failures;
};
