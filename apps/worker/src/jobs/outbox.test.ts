import { describe, expect, test } from "bun:test";

import type { EventEnvelope } from "@counted/kernel";

import { dispatchOutbox } from "./outbox";
import { recordingLogger } from "../logging";
import { anEnvelope, FakeOutbox, T0 } from "../testing";

const depsFor = (
  outbox: FakeOutbox,
  dispatch: (e: EventEnvelope) => Promise<void>,
  maxAttempts = 3,
) => {
  const logger = recordingLogger();
  return { outbox, dispatch, logger, batch: 10, maxAttempts };
};

describe("outbox dispatch", () => {
  test("everything delivered is marked in one call", async () => {
    const outbox = new FakeOutbox([anEnvelope("a"), anEnvelope("b")]);
    const deps = depsFor(outbox, async () => undefined);

    const report = await dispatchOutbox(deps, T0);

    expect(report).toEqual({ claimed: 2, dispatched: 2, failed: 0, deadLettered: 0, pending: 0 });
    expect(outbox.dispatched).toEqual(["a", "b"]);
  });

  /**
   * A failure in the middle must not cost the successes around it. If the
   * marking were per-envelope-on-success-only-if-nothing-failed, a flaky
   * subscriber would make the whole batch redeliver every tick forever.
   */
  test("a failure in the middle does not lose the deliveries around it", async () => {
    const outbox = new FakeOutbox([anEnvelope("a"), anEnvelope("b"), anEnvelope("c")]);
    const deps = depsFor(outbox, async (envelope) => {
      if (envelope.id === "b") throw new Error("receiver returned 500");
    });

    const report = await dispatchOutbox(deps, T0);

    expect(report).toMatchObject({ claimed: 3, dispatched: 2, failed: 1, deadLettered: 0 });
    expect(outbox.dispatched).toEqual(["a", "c"]);
    expect(outbox.failures).toEqual([{ id: "b", error: "receiver returned 500" }]);
    expect(report.pending).toBe(1);
  });

  test("an envelope past its attempt ceiling is dead-lettered, loudly, and not deleted", async () => {
    const outbox = new FakeOutbox([anEnvelope("a")]);
    outbox.setAttempts("a", 2);
    const deps = depsFor(
      outbox,
      async () => {
        throw new Error("gone for good");
      },
      3,
    );

    const report = await dispatchOutbox(deps, T0);

    expect(report).toMatchObject({ failed: 1, deadLettered: 1 });
    // The row survives — it is the evidence that a subscriber missed a fact.
    expect(report.pending).toBe(1);
    const line = deps.logger.lines.find((l) => l.event === "outbox.dead-lettered");
    expect(line?.level).toBe("error");
    expect(line?.fields["attempts"]).toBe(3);
  });

  test("a failure below the ceiling is a warning, because the next tick retries it", async () => {
    const outbox = new FakeOutbox([anEnvelope("a")]);
    const deps = depsFor(
      outbox,
      async () => {
        throw new Error("timeout");
      },
      3,
    );

    await dispatchOutbox(deps, T0);

    expect(deps.logger.lines.find((l) => l.event === "outbox.dispatch-failed")?.level).toBe("warn");
    expect(deps.logger.lines.some((l) => l.event === "outbox.dead-lettered")).toBe(false);
  });

  test("nothing to do is not an error", async () => {
    const outbox = new FakeOutbox([]);
    const report = await dispatchOutbox(depsFor(outbox, async () => undefined), T0);

    expect(report).toEqual({ claimed: 0, dispatched: 0, failed: 0, deadLettered: 0, pending: 0 });
  });
});
