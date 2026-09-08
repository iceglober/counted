/**
 * What any WebhookLedger must do.
 *
 * Four methods' worth of behaviour in two methods, and all of it is about one
 * property: **a claim is won exactly once, ever, by exactly one caller.**
 * Stripe delivers at-least-once and retries for three days, and the retry
 * usually arrives while the first attempt is still running — which is when a
 * `SELECT` followed by an `INSERT` has its window open.
 *
 * The concurrency test is the one that earns the suite. The in-memory double
 * passes it for free because JavaScript gave it a turn; the Postgres one passes
 * it because `INSERT … ON CONFLICT DO NOTHING RETURNING id` is atomic. A third
 * implementation that read-then-wrote would fail here and nowhere else.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { Instant, type Instant as InstantType } from "@counted/kernel";
import type { WebhookLedger } from "../ports";

export type WebhookLedgerHarness = {
  readonly ledger: WebhookLedger;
  /** A provider event id nothing has claimed. */
  freshEventId(): string;
  teardown?(): Promise<void>;
};

export const webhookLedgerContract = (
  label: string,
  create: () => Promise<WebhookLedgerHarness> | WebhookLedgerHarness,
  at: InstantType,
): void => {
  describe(`WebhookLedger contract: ${label}`, () => {
    let h!: WebhookLedgerHarness;

    beforeEach(async () => {
      h = await create();
    });
    afterEach(async () => {
      await h.teardown?.();
    });

    test("the first delivery claims the event", async () => {
      expect(await h.ledger.claim(h.freshEventId(), "checkout.session.completed", at)).toBe(true);
    });

    test("every redelivery of a claimed event is refused", async () => {
      const id = h.freshEventId();
      expect(await h.ledger.claim(id, "checkout.session.completed", at)).toBe(true);
      expect(await h.ledger.claim(id, "checkout.session.completed", at)).toBe(false);
      // Stripe retries for three days. The third and thirtieth attempt must
      // answer the same as the second.
      expect(
        await h.ledger.claim(
          id,
          "checkout.session.completed",
          Instant.fromEpochMillis(Instant.toEpochMillis(at) + 86_400_000),
        ),
      ).toBe(false);
    });

    test("a redelivery is refused even under a different type string", async () => {
      // The id is the idempotency key, not the pair. A provider that changed
      // its type vocabulary must not be able to re-apply an event we acted on.
      const id = h.freshEventId();
      expect(await h.ledger.claim(id, "invoice.paid", at)).toBe(true);
      expect(await h.ledger.claim(id, "invoice.payment_succeeded", at)).toBe(false);
    });

    test("different events are independent", async () => {
      expect(await h.ledger.claim(h.freshEventId(), "invoice.paid", at)).toBe(true);
      expect(await h.ledger.claim(h.freshEventId(), "invoice.paid", at)).toBe(true);
    });

    test("several deliveries racing produce exactly one claim", async () => {
      const id = h.freshEventId();
      const outcomes = await Promise.all(
        Array.from({ length: 8 }, () => h.ledger.claim(id, "invoice.paid", at)),
      );
      expect(outcomes.filter(Boolean).length).toBe(1);
    });

    test("marking processed does not un-claim the event", async () => {
      const id = h.freshEventId();
      await h.ledger.claim(id, "invoice.paid", at);
      await h.ledger.markProcessed(id, at);
      expect(await h.ledger.claim(id, "invoice.paid", at)).toBe(false);
    });

    test("marking an unclaimed event processed is not an error", async () => {
      // The route acknowledges everything that is not a signature failure, so
      // this call happens on paths where the claim was never made. It must not
      // throw and take a 200 away from the provider.
      await h.ledger.markProcessed(h.freshEventId(), at);
    });

    test("marking processed twice is not an error", async () => {
      const id = h.freshEventId();
      await h.ledger.claim(id, "invoice.paid", at);
      await h.ledger.markProcessed(id, at);
      await h.ledger.markProcessed(id, at);
    });
  });
};
