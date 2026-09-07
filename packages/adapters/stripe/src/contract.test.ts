/**
 * The BillingGateway contract, run against the real Stripe adapter.
 *
 * Not this package's tests — the port's, defined in
 * `@counted/tenancy-app/contract`, and the in-memory double in
 * `@counted/tenancy-app/testing` runs the same ones. The double's signature
 * scheme is a toy and this one is Stripe's HMAC-SHA256 over
 * `${timestamp}.${body}`; the *obligations* are identical, which is the point.
 *
 * **No live call is made and no Stripe key is needed.** `StripeApi` is the
 * two-endpoint slice this adapter uses, so the harness satisfies it in six
 * lines. Signature verification, translation and the tolerance window are all
 * real — they are pure functions over bytes, and this file exercises them the
 * way a delivery would. What is stubbed is the socket: what Stripe does when it
 * receives a checkout session is Stripe's behaviour, and nothing here claims to
 * prove it.
 */

import { billingGatewayContract } from "@counted/tenancy-app/contract";
import { Instant, WorkspaceId } from "@counted/kernel";
import { stripeBillingGateway, type StripeApi } from "./gateway";
import { METADATA_CADENCE, METADATA_PLAN, METADATA_WORKSPACE } from "./metadata";
import type { PlanPrices } from "./plans";
import { DEFAULT_TOLERANCE, signPayload } from "./signature";

const PRICES: PlanPrices = {
  pro: { monthly: "price_pro_monthly", annual: "price_pro_annual" },
};

/** The endpoint's signing secret. Keyed as text, prefix included — Stripe's rule. */
const SECRET = "whsec_ZmFrZS1zaWduaW5nLXNlY3JldA";
/** A well-formed secret this endpoint does not hold. */
const FOREIGN_SECRET = "whsec_c29tZWJvZHktZWxzZXMtc2VjcmV0";

const AT = Instant.fromEpochMillis(Date.UTC(2026, 0, 15, 12));

/** The two endpoints the adapter calls, and nothing else Stripe can do. */
const stubApi = (): StripeApi => ({
  prices: { retrieve: async () => ({ active: true, unit_amount: 999, currency: "usd", recurring: { interval: "month", interval_count: 1 } }) },
  subscriptions: { retrieve: async () => ({ cancel_at_period_end: false, items: { data: [] } }) },
  checkout: {
    sessions: {
      create: async () => ({
        url: "https://checkout.stripe.test/c/pay/cs_test_contract",
        expires_at: Math.floor(Instant.toEpochMillis(AT) / 1000) + 3600,
      }),
    },
  },
  billingPortal: {
    sessions: { create: async () => ({ url: "https://billing.stripe.test/p/session/contract" }) },
  },
});

billingGatewayContract(
  "stripe",
  () => {
    let sequence = 0;
    const next = (): number => (sequence += 1);

    /**
     * A Stripe event envelope, serialised the way a delivery arrives.
     *
     * Written out in full rather than built by a helper that hides the shape:
     * `data.object` is where every field the translator reads lives, and a
     * fixture that abbreviated it would stop proving that the translator can
     * find them.
     */
    const envelope = (type: string, object: Record<string, unknown>) => {
      const id = `evt_test_${next()}`;
      return { id, type, body: JSON.stringify({ id, type, data: { object } }) };
    };

    return {
      billing: stripeBillingGateway({ api: stubApi(), webhookSecret: SECRET, prices: PRICES }),
      sign: (body, at) => signPayload(SECRET, body, at),
      signWithWrongSecret: (body, at) => signPayload(FOREIGN_SECRET, body, at),
      checkoutCompleted: (workspace) =>
        envelope("checkout.session.completed", {
          id: `cs_test_${next()}`,
          object: "checkout.session",
          // Both guards the translator applies before it grants anything: a
          // setup-mode session is not a subscription starting, and a session
          // that completed unpaid can still be declined by the bank.
          mode: "subscription",
          payment_status: "paid",
          customer: `cus_test_${next()}`,
          subscription: `sub_test_${next()}`,
          client_reference_id: String(workspace),
          metadata: {
            [METADATA_WORKSPACE]: String(workspace),
            [METADATA_PLAN]: "pro",
            [METADATA_CADENCE]: "monthly",
          },
        }),
      // A real Stripe type the adapter deliberately does not translate. It has
      // to verify and come back with a null event, so the route can answer 200
      // and Stripe stops retrying it.
      unactionable: () =>
        envelope("invoice.upcoming", { id: `in_test_${next()}`, object: "invoice" }),
      tolerance: DEFAULT_TOLERANCE,
      aWorkspace: () => WorkspaceId(`ws_contract_${next()}`),
    };
  },
  AT,
);
