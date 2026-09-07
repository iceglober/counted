import { describe, expect, test } from "bun:test";
import { Duration, Instant, isErr, isOk, WorkspaceId } from "@counted/kernel";
import type { CheckoutRequest } from "@counted/tenancy-ports";
import type { PlanId } from "@counted/tenancy-domain";
import {
  stripeBillingGateway,
  type CheckoutSessionParams,
  type PortalSessionParams,
  type StripeApi,
} from "./gateway";
import { PlanUnavailableError, StripeProviderError } from "./errors";
import { signPayload } from "./signature";
import { METADATA_PLAN, METADATA_WORKSPACE } from "./metadata";
import type { PlanPrices } from "./plans";

const PRICES: PlanPrices = {
  pro: { monthly: "price_pro_monthly", annual: "price_pro_annual" },
};
const SECRET = "whsec_ZmFrZS1zaWduaW5nLXNlY3JldA";
const NOW = Instant.fromEpochMillis(1_735_689_600_000);
const EXPIRES = 1_735_693_200;

const stub = (
  over: {
    checkout?: (params: CheckoutSessionParams) => Promise<{ url: string | null; expires_at: number }>;
    portal?: (params: PortalSessionParams) => Promise<{ url: string }>;
  } = {},
) => {
  const checkoutCalls: CheckoutSessionParams[] = [];
  const portalCalls: PortalSessionParams[] = [];
  const api: StripeApi = {
    prices: { retrieve: async (id) => ({ active: true, unit_amount: id === PRICES.pro.monthly ? 999 : 9999, currency: "usd", recurring: { interval: id === PRICES.pro.monthly ? "month" : "year", interval_count: 1 } }) },
    subscriptions: { retrieve: async () => ({ cancel_at_period_end: false, items: { data: [] } }) },
    checkout: {
      sessions: {
        create: async (params) => {
          checkoutCalls.push(params);
          return over.checkout
            ? await over.checkout(params)
            : { url: "https://checkout.stripe.test/c/pay/cs_1", expires_at: EXPIRES };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (params) => {
          portalCalls.push(params);
          return over.portal ? await over.portal(params) : { url: "https://billing.stripe.test/p/1" };
        },
      },
    },
  };
  return { api, checkoutCalls, portalCalls };
};

const gateway = (api: StripeApi) =>
  stripeBillingGateway({ api, webhookSecret: SECRET, prices: PRICES });

describe("billing display details", () => {
  test("reads the exact configured monthly and annual amounts without exposing provider ids", async () => {
    const prices = await gateway(stub().api).prices();
    expect(prices).toEqual([
      { plan: "pro", cadence: "monthly", amount: 999, currency: "usd" },
      { plan: "pro", cadence: "annual", amount: 9999, currency: "usd" },
    ]);
  });
  test("refuses inactive, variable, and mismatched recurring prices", async () => {
    for (const override of [{ active: false }, { unit_amount: null }, { recurring: { interval: "week", interval_count: 1 } }]) {
      const api = stub().api;
      const original = api.prices.retrieve;
      const broken: StripeApi = { ...api, prices: { retrieve: async id => ({ ...await original(id), ...override }) } };
      await expect(gateway(broken).prices()).rejects.toThrow(StripeProviderError);
    }
  });
  test("reads annual cadence and scheduled cancellation from the current subscription item", async () => {
    const api: StripeApi = { ...stub().api, subscriptions: { retrieve: async () => ({
      cancel_at_period_end: true, items: { data: [{ current_period_end: EXPIRES, quantity: 2, price: { unit_amount: 5000, currency: "usd", recurring: { interval: "year", interval_count: 1 } } }] },
    }) } };
    expect(await gateway(api).subscriptionDetails("sub_existing")).toEqual({ cadence: "annual", price: { amount: 10000, currency: "usd" }, cancelAtPeriodEnd: true, periodEndsAt: Instant.fromEpochMillis(EXPIRES * 1000) });
  });
});

const checkout = (over: Partial<CheckoutRequest<PlanId>> = {}): CheckoutRequest<PlanId> => ({
  workspace: WorkspaceId("ws_1"),
  plan: "pro",
  cadence: "monthly",
  customer: null,
  successUrl: "https://app.counted.test/billing?done=1",
  cancelUrl: "https://app.counted.test/billing",
  ...over,
});

describe("createCheckoutSession", () => {
  test("sells the price the cadence names", async () => {
    const { api, checkoutCalls } = stub();
    await gateway(api).createCheckoutSession(checkout({ cadence: "annual" }));
    expect(checkoutCalls[0]?.line_items).toEqual([{ price: "price_pro_annual", quantity: 1 }]);
  });

  test("returns the hosted URL and when it stops working", async () => {
    const { api } = stub();
    expect(await gateway(api).createCheckoutSession(checkout())).toEqual({
      url: "https://checkout.stripe.test/c/pay/cs_1",
      expiresAt: Instant.fromEpochMillis(EXPIRES * 1000),
    });
  });

  test("writes the workspace onto the subscription, not only the session", async () => {
    // Every later `customer.subscription.*` event carries the subscription's
    // metadata and knows nothing about the session that created it. Set this in
    // one place and every renewal, cancellation and card failure arrives
    // unattributable.
    const { api, checkoutCalls } = stub();
    await gateway(api).createCheckoutSession(checkout());
    const params = checkoutCalls[0];
    expect(params?.metadata[METADATA_WORKSPACE]).toBe("ws_1");
    expect(params?.subscription_data.metadata[METADATA_WORKSPACE]).toBe("ws_1");
    expect(params?.subscription_data.metadata[METADATA_PLAN]).toBe("pro");
  });

  test("omits the customer for a first-time subscriber rather than sending null", async () => {
    // Stripe creates the customer when the field is absent and rejects an
    // explicit null as a parameter error.
    const { api, checkoutCalls } = stub();
    await gateway(api).createCheckoutSession(checkout({ customer: null }));
    expect("customer" in (checkoutCalls[0] as object)).toBe(false);
  });

  test("reuses an existing customer when there is one", async () => {
    const { api, checkoutCalls } = stub();
    await gateway(api).createCheckoutSession(checkout({ customer: "cus_existing" }));
    expect(checkoutCalls[0]?.customer).toBe("cus_existing");
  });

  test("refuses to sell the free plan", async () => {
    // Reachable because the port is generic over every plan id. You do not
    // check out of free; you arrive at it by cancelling.
    const { api, checkoutCalls } = stub();
    await expect(gateway(api).createCheckoutSession(checkout({ plan: "free" }))).rejects.toBeInstanceOf(
      PlanUnavailableError,
    );
    expect(checkoutCalls).toHaveLength(0);
  });

  test("a Stripe failure becomes one error shape at the boundary", async () => {
    // Not a StripeInvalidRequestError leaking into a route handler.
    const { api } = stub({
      checkout: () => Promise.reject(Object.assign(new Error("No such price"), { statusCode: 400 })),
    });
    const error = await gateway(api).createCheckoutSession(checkout()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StripeProviderError);
    expect((error as StripeProviderError).status).toBe(400);
  });

  test("a session with no URL is a provider failure, not a redirect to undefined", async () => {
    const { api } = stub({ checkout: async () => ({ url: null, expires_at: EXPIRES }) });
    await expect(gateway(api).createCheckoutSession(checkout())).rejects.toBeInstanceOf(
      StripeProviderError,
    );
  });
});

describe("createPortalSession", () => {
  test("returns the portal URL with no invented expiry", async () => {
    // Stripe expires the link on first use and publishes no window. Reporting
    // null is honest; picking a number is not.
    const { api, portalCalls } = stub();
    expect(
      await gateway(api).createPortalSession({
        customer: "cus_1",
        returnUrl: "https://app.counted.test/billing",
      }),
    ).toEqual({ url: "https://billing.stripe.test/p/1", expiresAt: null });
    expect(portalCalls[0]).toEqual({
      customer: "cus_1",
      return_url: "https://app.counted.test/billing",
    });
  });

  test("a Stripe failure is wrapped", async () => {
    const { api } = stub({ portal: () => Promise.reject(new Error("gateway timeout")) });
    await expect(
      gateway(api).createPortalSession({ customer: "cus_1", returnUrl: "https://x.test" }),
    ).rejects.toBeInstanceOf(StripeProviderError);
  });
});

describe("verifyWebhook", () => {
  const body = JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_1",
        object: "subscription",
        status: "active",
        metadata: { counted_workspace: "ws_1", counted_plan: "pro" },
        items: { object: "list", data: [{ id: "si_1", current_period_end: 1_767_225_600 }] },
      },
    },
  });

  test("verifies and translates in one pass", async () => {
    const { api } = stub();
    const result = gateway(api).verifyWebhook(body, signPayload(SECRET, body, NOW), NOW);
    expect(isOk(result) && result.value).toMatchObject({
      id: "evt_1",
      type: "customer.subscription.updated",
      workspace: WorkspaceId("ws_1"),
      event: { kind: "subscription_updated", plan: "pro", active: true },
    });
  });

  test("never throws — every webhook outcome is a value", async () => {
    // The three unhappy paths that a route handler must be able to answer 400
    // to without an exception filter.
    const { api } = stub();
    const g = gateway(api);
    expect(isErr(g.verifyWebhook(body, undefined, NOW))).toBe(true);
    expect(isErr(g.verifyWebhook(body, "t=1,v1=dead", NOW))).toBe(true);
    expect(isErr(g.verifyWebhook(body, signPayload(SECRET, body, NOW), Instant.plus(NOW, Duration.hours(1))))).toBe(
      true,
    );
  });

  test("a signed body that is not JSON is a value, not a throw", () => {
    // Should be impossible — we signed it — but "impossible" is not a reason
    // for the only exception on the path to be a SyntaxError.
    const { api } = stub();
    const junk = "not json at all";
    const result = gateway(api).verifyWebhook(junk, signPayload(SECRET, junk, NOW), NOW);
    expect(isErr(result) && result.error.kind).toBe("Malformed");
  });

  test("an unhandled event type is acknowledged rather than refused", async () => {
    // Stripe retries a non-2xx for three days. An endpoint that fails on every
    // type it does not handle spends those days being hammered while the ones
    // it does handle queue behind them.
    const other = JSON.stringify({
      id: "evt_2",
      object: "event",
      type: "charge.dispute.created",
      data: { object: { id: "dp_1" } },
    });
    const { api } = stub();
    const result = gateway(api).verifyWebhook(other, signPayload(SECRET, other, NOW), NOW);
    expect(isOk(result) && result.value.event).toBeNull();
    expect(isOk(result) && result.value.id).toBe("evt_2");
  });
});
