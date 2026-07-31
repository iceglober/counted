/**
 * The JavaScript driver.
 *
 * A virtual clock and a **scripted** server around the real SDK. Nothing
 * inside the SDK is mocked — the queue, the transport and the retry logic are
 * the shipped ones, and only time and the network are under the test's
 * control.
 *
 * The subtle part is ordering. A scenario reads:
 *
 *     { "do": "flush" }
 *     { "expect": "request", "events": ["a"] }
 *     { "respond": { "status": 429 } }
 *
 * — the response is declared *after* the request is asserted, because that is
 * how it reads. But the SDK needs an answer during the call. So a request
 * parks on a promise the scenario resolves later: `flush()` is started and not
 * awaited, `expect` inspects the parked request, and `respond` releases it.
 *
 * My first version answered at request time from a queue, which meant every
 * `respond` applied to the *next* request rather than the one just asserted.
 * Three scenarios failed for that reason and none of them was an SDK bug.
 */

import { Counted } from "@counted/sdk-js";
import type { CapturedRequest, Harness } from "./runner";

type Answer = { status: number; headers?: Record<string, string>; body?: unknown } | "network-error";

type Pending = {
  readonly request: CapturedRequest;
  readonly settle: (answer: Answer) => void;
};

export const createJsHarness = (options: Record<string, unknown> = {}): Harness => {
  let clock = Date.parse("2026-03-17T15:00:00.000Z");
  const captured: CapturedRequest[] = [];
  const pending: Pending[] = [];
  /** Started and not yet finished. Kept so a rejection is never unhandled. */
  const inFlight = new Set<Promise<unknown>>();

  const fetchImpl = (async (url: unknown, init: RequestInit) => {
    const request: CapturedRequest = {
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init.body)) as CapturedRequest["body"],
    };
    captured.push(request);

    return new Promise<Response>((resolve, reject) => {
      pending.push({
        request,
        settle: (answer) => {
          if (answer === "network-error") {
            reject(new Error("connection reset"));
            return;
          }
          resolve(
            new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), {
              status: answer.status,
              headers: answer.headers,
            }),
          );
        },
      });
    });
  }) as unknown as typeof fetch;

  const counted = new Counted({
    key: "ck_conformance",
    endpoint: "https://api.test/v1/events",
    // Driven explicitly: a wall-clock timer would race the virtual one.
    flushIntervalMs: 0,
    now: () => clock,
    fetch: fetchImpl,
    onDiagnostic: () => {},
    ...options,
  } as never);

  /**
   * Let work already started run to completion.
   *
   * Macrotask turns, not just microtasks. `Response.json()` does not resolve
   * within a microtask drain, so a microtask-only settle left a flush
   * half-finished — and because the SDK joins an in-flight flush rather than
   * starting a second, the *next* flush then silently did nothing. Two
   * scenarios failed that way and neither was an SDK bug.
   *
   * Safe against a virtual clock because the SDK's own timers are disabled in
   * conformance: nothing here is racing a real interval.
   */
  const settle = async (): Promise<void> => {
    // Yields turns; deliberately does not await the in-flight flushes. One of
    // them is usually parked on a request the scenario has not answered yet,
    // and awaiting it would deadlock the runner rather than settle it.
    for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const start = (work: Promise<unknown>): void => {
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
  };

  return {
    driver: {
      track: (name, properties) => counted.track(name, properties as never),
      identify: (userId) => counted.identify(userId),
      reset: () => counted.reset(),
      // Started, not awaited: awaiting would deadlock against a request the
      // scenario has not answered yet.
      flush: async () => {
        start(counted.flush());
        await settle();
      },
      shutdown: async () => {
        start(counted.shutdown());
        await settle();
      },
    },
    advance: async (ms) => {
      clock += ms;
      // How a real timer would have driven it. Whether that produces a request
      // is the scenario's assertion, not this function's business.
      start(counted.flush());
      await settle();
    },
    settle,
    drain: () => captured.splice(0, captured.length),
    enqueueResponse: (answer) => {
      const next = pending.shift();
      // A response with nothing waiting means the scenario expected a request
      // that was never made. Silently dropping it would make the *next*
      // assertion fail for the wrong reason.
      if (next === undefined) throw new Error("respond: no request is waiting");
      next.settle(answer as Answer);
    },
  };
};
