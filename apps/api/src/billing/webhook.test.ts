/**
 * The Stripe webhook route.
 *
 * One rule shapes every test here: **Stripe retries a non-2xx for three days.**
 * An endpoint that 500s on the event types it does not handle spends those days
 * being hammered while the ones it does handle queue behind it. So everything
 * that is not a signature failure answers 200 — an unrecognised type and an
 * event about a customer we cannot identify included, because retrying will not
 * make an unknown customer known.
 *
 * The body is read as text and never re-serialised. A signature is computed
 * over the bytes exactly as sent, and a framework that parsed the JSON has
 * destroyed the thing being verified — which is the entire reason this route is
 * not an oRPC procedure.
 */

import { describe, expect, test } from "bun:test";
import { Instant } from "@counted/kernel";
import type { RecordBillingEventDeps } from "@counted/tenancy-app";
import { STRIPE_SIGNATURE_HEADER, handleStripeWebhook } from "./webhook";
import { silentLogger } from "../logging";

const AT = Instant.fromEpochMillis(1_700_000_000_000);

/**
 * The gateway is the only part this route touches directly. Everything past the
 * verification is `recordBillingEvent`'s, which has its own tests — so the
 * double stops at `verifyWebhook` and the ledger records what it was asked.
 */
const billing = (
  verify: RecordBillingEventDeps["billing"]["verifyWebhook"],
  seen: { body?: string | undefined; signature?: string | undefined } = {},
): RecordBillingEventDeps => ({
  billing: {
    prices: async () => [],
    subscriptionDetails: async () => ({ cadence: null, price: null, cancelAtPeriodEnd: false, periodEndsAt: null }),
    createCheckoutSession: async () => { throw new Error("unused"); },
    createPortalSession: async () => { throw new Error("unused"); },
    verifyWebhook: (body, signature, at) => {
      seen.body = body;
      seen.signature = signature;
      return verify(body, signature, at);
    },
  },
  workspaces: { find: async () => null, listForAccount: async () => [], save: async () => {} },
  subscriptions: {
    find: async () => null,
    findByCustomer: async () => null,
    findBySubscriptionRef: async () => null,
    save: async () => {},
  },
  memberships: { roleOf: async () => null, membersOf: async () => [] },
  ledger: { claim: async () => true, markProcessed: async () => {} },
});

const post = (body: string, signature?: string): Request =>
  new Request("http://api.test/v1/webhooks/stripe", {
    method: "POST",
    headers: signature === undefined ? {} : { [STRIPE_SIGNATURE_HEADER]: signature },
    body,
  });

const verified = (id: string, type: string) =>
  ({ ok: true, value: { id, type, workspace: null, event: null } }) as const;

describe("signature failures", () => {
  test("a bad signature is 400 and never retried", async () => {
    const outcome = await handleStripeWebhook(
      { billing: billing(() => ({ ok: false, error: { kind: "BadSignature" } })), logger: silentLogger },
      post("{}", "t=1,v1=nope"),
      AT,
    );
    expect(outcome.status).toBe(400);
  });

  /**
   * A stale delivery is a replay. Distinguishing it from a forgery matters to
   * the log — a clock-skew outage looks like an attack otherwise — and not to
   * the caller, who gets the same 400 either way.
   */
  test("a stale delivery is 400 and its age reaches the log", async () => {
    const lines: string[] = [];
    const outcome = await handleStripeWebhook(
      {
        billing: billing(() => ({ ok: false, error: { kind: "Stale", ageSeconds: 900 } })),
        logger: {
          debug: () => {}, info: () => {},
          warn: (message, fields) => lines.push(`${message}:${JSON.stringify(fields)}`),
          error: () => {},
          with: () => silentLogger,
        },
      },
      post("{}", "t=1,v1=old"),
      AT,
    );
    expect(outcome.status).toBe(400);
    expect(lines.join()).toContain("900");
  });

  test("a body we cannot read is 400, not 500", async () => {
    const outcome = await handleStripeWebhook(
      {
        billing: billing(() => ({ ok: false, error: { kind: "Malformed", detail: "no id" } })),
        logger: silentLogger,
      },
      post("not json", "sig"),
      AT,
    );
    expect(outcome.status).toBe(400);
  });
});

describe("what is acknowledged", () => {
  /**
   * The whole point. An event type we do not translate is not an error, and
   * answering 500 to it means three days of retries crowding out the ones we do
   * handle.
   */
  test("an event type we do not handle is 200", async () => {
    const outcome = await handleStripeWebhook(
      { billing: billing(() => verified("evt_1", "invoice.upcoming")), logger: silentLogger },
      post('{"id":"evt_1"}', "sig"),
      AT,
    );
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ received: true, result: "ignored" });
  });

  test("a redelivery the ledger has already claimed is 200 and writes nothing", async () => {
    const deps = billing(() => verified("evt_1", "invoice.upcoming"));
    const outcome = await handleStripeWebhook(
      {
        billing: { ...deps, ledger: { claim: async () => false, markProcessed: async () => {} } },
        logger: silentLogger,
      },
      post('{"id":"evt_1"}', "sig"),
      AT,
    );
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ received: true, result: "duplicate" });
  });
});

describe("the raw body", () => {
  /**
   * The signature is computed over the bytes exactly as sent. A route that
   * parsed and re-serialised would change key order and whitespace, and every
   * genuine delivery would fail verification.
   */
  test("the gateway is handed the body verbatim, with the header", async () => {
    const seen: { body?: string | undefined; signature?: string | undefined } = {};
    const raw = '{"id":"evt_1",\n  "type":"x"}';
    await handleStripeWebhook(
      {
        billing: billing(() => verified("evt_1", "x"), seen),
        logger: silentLogger,
      },
      post(raw, "t=1,v1=abc"),
      AT,
    );
    expect(seen.body).toBe(raw);
    expect(seen.signature).toBe("t=1,v1=abc");
  });

  test("a delivery with no signature header still reaches the gateway", async () => {
    const seen: { signature?: string | undefined } = {};
    await handleStripeWebhook(
      { billing: billing(() => ({ ok: false, error: { kind: "BadSignature" } }), seen), logger: silentLogger },
      post("{}"),
      AT,
    );
    // `undefined`, not `""` — the gateway decides what a missing header means,
    // and an empty string is a signature that failed rather than one absent.
    expect(seen.signature).toBeUndefined();
  });
});
