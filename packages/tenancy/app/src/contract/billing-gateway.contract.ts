/**
 * What any BillingGateway must do.
 *
 * Three methods, and the split between them is the contract. Checkout and
 * portal are network calls that hand back a URL to redirect to, so they may
 * throw. `verifyWebhook` is pure computation over bytes we already hold, it is
 * synchronous, and **every outcome is a value** — a forged delivery is an
 * `err`, not an exception, because the route that calls it has to answer 400
 * rather than 500 and Stripe reads those differently.
 *
 * The assertion that matters most is the forgery one. A signature check is the
 * only thing standing between a public HTTP endpoint and "anyone on the
 * internet can grant themselves the paid plan", and it is also the check that
 * fails open most quietly: a verifier that always returned `ok` passes every
 * happy-path test ever written for it. So the suite signs a body, changes one
 * byte of it, and requires `BadSignature`.
 *
 * **The signing scheme is the harness's, not the suite's.** Stripe's is
 * HMAC-SHA256 over `${timestamp}.${body}` keyed with the whole `whsec_…`
 * string; the in-memory double's is a toy. The contract is about the
 * *obligations* — a body that was not signed with our secret is refused, a
 * delivery outside the tolerance is `Stale` and says how stale, an event we do
 * not translate is `ok` with a null event — and those are the same either way.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Duration, Instant, type Instant as InstantType, type WorkspaceId } from "@counted/kernel";
import type { BillingGateway } from "../ports";
import { expectErr, expectOk } from "./result";

/** One prepared delivery: the bytes, and what the gateway must make of them. */
export type PreparedDelivery = {
  readonly body: string;
  readonly id: string;
  readonly type: string;
};

export type BillingGatewayHarness = {
  readonly billing: BillingGateway;
  /** The `stripe-signature`-equivalent header this gateway would accept. */
  sign(body: string, at: InstantType): string;
  /** A header signed with a secret this gateway does not hold. */
  signWithWrongSecret(body: string, at: InstantType): string;
  /** A delivery that translates into a `checkout_completed` for `workspace`. */
  checkoutCompleted(workspace: WorkspaceId): PreparedDelivery;
  /** A delivery that verifies and translates to nothing we act on. */
  unactionable(): PreparedDelivery;
  /** How old a delivery may be before this gateway calls it stale. */
  readonly tolerance: Duration;
  /** A workspace id to attribute prepared deliveries to. */
  aWorkspace(): WorkspaceId;
  teardown?(): Promise<void>;
};

export const billingGatewayContract = (
  label: string,
  create: () => Promise<BillingGatewayHarness> | BillingGatewayHarness,
  at: InstantType,
): void => {
  describe(`BillingGateway contract: ${label}`, () => {
    let h!: BillingGatewayHarness;

    beforeEach(async () => {
      h = await create();
    });
    afterEach(async () => {
      await h.teardown?.();
    });

    // ── hosted sessions ───────────────────────────────────────────────────

    test("checkout returns a hosted session with somewhere to send the browser", async () => {
      const session = await h.billing.createCheckoutSession({
        workspace: h.aWorkspace(),
        plan: "pro",
        cadence: "monthly",
        customer: null,
        successUrl: "https://console.test/upgraded",
        cancelUrl: "https://console.test/settings",
      });
      expect(typeof session.url).toBe("string");
      expect(session.url.length).toBeGreaterThan(0);
    });

    test("checkout for a returning customer is accepted too", async () => {
      // The first-time and returning cases take different branches — Stripe
      // creates the customer in one and is handed it in the other — and the
      // returning one is the branch nobody exercises by accident.
      const session = await h.billing.createCheckoutSession({
        workspace: h.aWorkspace(),
        plan: "pro",
        cadence: "annual",
        customer: "cus_existing",
        successUrl: "https://console.test/upgraded",
        cancelUrl: "https://console.test/settings",
      });
      expect(session.url.length).toBeGreaterThan(0);
    });

    test("the portal returns a hosted session for an existing customer", async () => {
      const session = await h.billing.createPortalSession({
        customer: "cus_existing",
        returnUrl: "https://console.test/settings",
      });
      expect(session.url.length).toBeGreaterThan(0);
    });

    // ── verification ──────────────────────────────────────────────────────

    test("a correctly signed delivery verifies, carrying its id and type", async () => {
      const delivery = h.checkoutCompleted(h.aWorkspace());
      const verified = expectOk(
        h.billing.verifyWebhook(delivery.body, h.sign(delivery.body, at), at),
        "a signed delivery",
      );
      expect(verified.id).toBe(delivery.id);
      expect(verified.type).toBe(delivery.type);
    });

    test("a signed delivery that names a workspace reports it", async () => {
      const workspace = h.aWorkspace();
      const delivery = h.checkoutCompleted(workspace);
      const verified = expectOk(
        h.billing.verifyWebhook(delivery.body, h.sign(delivery.body, at), at),
        "a signed delivery",
      );
      expect(verified.workspace).toBe(workspace);
      expect(verified.event).not.toBeNull();
    });

    test("a forged delivery is refused — one changed byte after signing", async () => {
      // The whole reason `verifyWebhook` takes raw bytes. If this passes with
      // the body tampered, the endpoint is a public "grant me the paid plan"
      // button and no other test in the codebase would notice.
      const delivery = h.checkoutCompleted(h.aWorkspace());
      const signature = h.sign(delivery.body, at);
      const tampered = delivery.body.replace(/}$/, ', "injected": true}');
      expect(tampered).not.toBe(delivery.body);

      const rejection = expectErr(
        h.billing.verifyWebhook(tampered, signature, at),
        "a tampered body",
      );
      expect(rejection.kind).toBe("BadSignature");
    });

    test("a delivery signed with somebody else's secret is refused", async () => {
      const delivery = h.checkoutCompleted(h.aWorkspace());
      const rejection = expectErr(
        h.billing.verifyWebhook(delivery.body, h.signWithWrongSecret(delivery.body, at), at),
        "a foreign signature",
      );
      expect(rejection.kind).toBe("BadSignature");
    });

    test("a delivery with no signature header at all is refused", async () => {
      const delivery = h.checkoutCompleted(h.aWorkspace());
      expect(
        expectErr(h.billing.verifyWebhook(delivery.body, undefined, at), "no header").kind,
      ).toBe("BadSignature");
      expect(expectErr(h.billing.verifyWebhook(delivery.body, "", at), "empty header").kind).toBe(
        "BadSignature",
      );
    });

    test("a signature moved onto a different body is refused", async () => {
      // Replay with substitution: capture a genuine delivery's header and put
      // it on a body that upgrades a different workspace.
      const mine = h.checkoutCompleted(h.aWorkspace());
      const theirs = h.checkoutCompleted(h.aWorkspace());
      if (mine.body === theirs.body) return;

      expect(
        expectErr(
          h.billing.verifyWebhook(theirs.body, h.sign(mine.body, at), at),
          "a borrowed signature",
        ).kind,
      ).toBe("BadSignature");
    });

    test("a delivery older than the tolerance is stale, and says how stale", async () => {
      const delivery = h.checkoutCompleted(h.aWorkspace());
      const signedAt = Instant.fromEpochMillis(
        Instant.toEpochMillis(at) - Duration.toMillis(h.tolerance) - 60_000,
      );
      const rejection = expectErr(
        h.billing.verifyWebhook(delivery.body, h.sign(delivery.body, signedAt), at),
        "a stale delivery",
      );
      expect(rejection.kind).toBe("Stale");
      if (rejection.kind === "Stale") expect(rejection.ageSeconds).toBeGreaterThan(0);
    });

    test("a delivery from the future is refused too", async () => {
      // A receiver that only bounds the past accepts a captured delivery
      // replayed with the sender's clock wound forward.
      const delivery = h.checkoutCompleted(h.aWorkspace());
      const signedAt = Instant.fromEpochMillis(
        Instant.toEpochMillis(at) + Duration.toMillis(h.tolerance) + 60_000,
      );
      expect(
        expectErr(
          h.billing.verifyWebhook(delivery.body, h.sign(delivery.body, signedAt), at),
          "a future delivery",
        ).kind,
      ).toBe("Stale");
    });

    test("a delivery inside the tolerance still verifies", async () => {
      const delivery = h.checkoutCompleted(h.aWorkspace());
      const signedAt = Instant.fromEpochMillis(
        Instant.toEpochMillis(at) - Math.floor(Duration.toMillis(h.tolerance) / 2),
      );
      expectOk(
        h.billing.verifyWebhook(delivery.body, h.sign(delivery.body, signedAt), at),
        "a delivery just inside the window",
      );
    });

    test("freshness is decided after the signature, never before", async () => {
      // Checking the age of an unauthenticated timestamp first tells an
      // attacker whether their forged body would otherwise have verified.
      const delivery = h.checkoutCompleted(h.aWorkspace());
      const signedAt = Instant.fromEpochMillis(
        Instant.toEpochMillis(at) - Duration.toMillis(h.tolerance) - 60_000,
      );
      const tampered = `${delivery.body} `;
      expect(
        expectErr(
          h.billing.verifyWebhook(tampered, h.sign(delivery.body, signedAt), at),
          "stale and forged",
        ).kind,
      ).toBe("BadSignature");
    });

    test("an event we do not act on verifies and translates to nothing", async () => {
      // Recorded and acknowledged anyway. Stripe retries a non-2xx for three
      // days, so an endpoint that errors on the types it does not handle spends
      // those days being hammered while the ones it does handle queue behind.
      const delivery = h.unactionable();
      const verified = expectOk(
        h.billing.verifyWebhook(delivery.body, h.sign(delivery.body, at), at),
        "an unactionable event",
      );
      expect(verified.id).toBe(delivery.id);
      expect(verified.event).toBeNull();
    });

    test("verification is pure: the same delivery verifies as often as it is presented", async () => {
      // Deduplication is the ledger's job. A gateway that remembered deliveries
      // would make the ledger's claim untestable and would swallow a genuine
      // retry after a crash between verification and commit.
      const delivery = h.checkoutCompleted(h.aWorkspace());
      const signature = h.sign(delivery.body, at);
      const first = expectOk(h.billing.verifyWebhook(delivery.body, signature, at), "first");
      const second = expectOk(h.billing.verifyWebhook(delivery.body, signature, at), "second");
      expect(second).toEqual(first);
    });
  });
};
