/**
 * What an outbox over Postgres has to get right.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";
import { Instant, type EventEnvelope } from "@counted/kernel";
import { T0, at, liveHarness, type Harness } from "./fixtures";
import { PostgresOutbox } from "./outbox";
import { closeDatabase, describeLive } from "./testing";

const event = (id: string, minutes: number): EventEnvelope => ({
  id,
  type: "tenancy.WorkspaceRenamed",
  occurredAt: at(minutes),
  payload: { kind: "WorkspaceRenamed", at: at(minutes) },
});

describeLive("PostgresOutbox", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await liveHarness();
    await h.reset();
  });
  afterAll(closeDatabase);

  test("what goes in comes out, oldest first", async () => {
    await h.repositories.outbox.enqueue([event("e3", 3), event("e1", 1), event("e2", 2)]);
    const claimed = await h.repositories.outbox.claim(10);
    expect(claimed.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(claimed[0]?.occurredAt).toEqual(at(1));
    expect(claimed[0]?.payload).toEqual({ kind: "WorkspaceRenamed", at: at(1) });
  });

  test("enqueuing the same envelope twice enqueues it once", async () => {
    // The id is minted by the use case and is stable across redeliveries, so a
    // retried command must not produce two of the same notification.
    await h.repositories.outbox.enqueue([event("e1", 1)]);
    await h.repositories.outbox.enqueue([event("e1", 1)]);
    expect(await h.repositories.outbox.pendingCount()).toBe(1);
  });

  test("two workers claiming at the same time never take the same row", async () => {
    // This is what SKIP LOCKED buys. With a plain SELECT both workers read the
    // same rows and the customer gets two of every notification.
    await h.repositories.outbox.enqueue([
      event("e1", 1),
      event("e2", 2),
      event("e3", 3),
      event("e4", 4),
    ]);

    const one = await h.pool.connect();
    const two = await h.pool.connect();
    try {
      await one.query("BEGIN");
      await two.query("BEGIN");
      const [first, second] = await Promise.all([
        new PostgresOutbox(one).claim(2),
        new PostgresOutbox(two).claim(2),
      ]);
      await one.query("COMMIT");
      await two.query("COMMIT");

      const ids = [...first, ...second].map((e) => e.id).sort();
      expect(ids).toEqual(["e1", "e2", "e3", "e4"]);
      expect(new Set(ids).size).toBe(4);
    } finally {
      one.release();
      two.release();
    }
  });

  test("a claimed event is not handed out again while its lease holds", async () => {
    await h.repositories.outbox.enqueue([event("e1", 1)]);
    expect((await h.repositories.outbox.claim(10)).map((e) => e.id)).toEqual(["e1"]);
    expect(await h.repositories.outbox.claim(10)).toEqual([]);
  });

  test("a crashed worker's claim expires, so its events are not lost forever", async () => {
    // The events nobody ever sees are exactly the ones nobody notices are
    // missing. `claimed_at` is a lease, not a flag.
    await h.repositories.outbox.enqueue([event("e1", 1)]);
    await h.repositories.outbox.claim(10);

    const impatient = new PostgresOutbox(h.pool, { leaseSeconds: 0 });
    expect((await impatient.claim(10)).map((e) => e.id)).toEqual(["e1"]);
  });

  test("a failure makes the row claimable again immediately", async () => {
    // Leaving the claim in place would make a transient 502 cost a full lease of
    // silence before anyone retried.
    await h.repositories.outbox.enqueue([event("e1", 1)]);
    await h.repositories.outbox.claim(10);

    expect(await h.repositories.outbox.recordFailure("e1", "502 from webhook", T0)).toBe(1);
    expect((await h.repositories.outbox.claim(10)).map((e) => e.id)).toEqual(["e1"]);
    expect(await h.repositories.outbox.recordFailure("e1", "502 again", T0)).toBe(2);
  });

  test("recording a failure against a row that is not there is an error, not a zeroth attempt", async () => {
    expect(h.repositories.outbox.recordFailure("ghost", "boom", T0)).rejects.toThrow(/ghost/);
  });

  test("dispatched events leave the pending count and are never claimed again", async () => {
    await h.repositories.outbox.enqueue([event("e1", 1), event("e2", 2)]);
    const claimed = await h.repositories.outbox.claim(10);
    await h.repositories.outbox.markDispatched(
      claimed.map((e) => e.id),
      Instant.fromEpochMillis(Instant.toEpochMillis(T0)),
    );

    expect(await h.repositories.outbox.pendingCount()).toBe(0);
    expect(await new PostgresOutbox(h.pool, { leaseSeconds: 0 }).claim(10)).toEqual([]);
  });

  test("a payload that is not a domain event is refused rather than dispatched", async () => {
    await h.repositories.outbox.enqueue([event("e1", 1)]);
    await h.pool.query(`UPDATE outbox SET payload = '{"nope":true}'::jsonb WHERE id = 'e1'`);
    expect(h.repositories.outbox.claim(10)).rejects.toThrow(/outbox\.payload/);
  });
});
