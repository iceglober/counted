/**
 * `BillingGateway` over Stripe.
 *
 * Three methods, and the split between them is the point. Checkout and portal
 * are network calls that return a URL to redirect to; verifying a webhook is
 * pure computation over bytes we already hold. The port has the first two async
 * and the third synchronous for that reason, and this file keeps it that way —
 * see signature.ts for why the SDK cannot be used on the synchronous path.
 *
 * Stripe never decides an entitlement here. It is asked to sell a price and it
 * reports what happened to a payment; `Entitlement.resolve` in
 * `@counted/tenancy-domain` turns that into permission, and nothing in this
 * package imports or reimplements it.
 */

import { err, Instant, unbrand, type Duration, type Result } from "@counted/kernel";
import type {
  BillingGateway,
  CheckoutRequest,
  HostedSession,
  PortalRequest,
  VerifiedWebhook,
  WebhookRejection,
} from "@counted/tenancy-ports";
import type { BillingEvent, PlanId } from "@counted/tenancy-domain";
import { PlanUnavailableError, StripeProviderError } from "./errors";
import { METADATA_CADENCE, METADATA_PLAN, METADATA_WORKSPACE } from "./metadata";
import { priceFor, type PlanPrices } from "./plans";
import { verifyStripeSignature } from "./signature";
import { translateStripeEvent } from "./translate";

/**
 * The slice of the Stripe client this adapter uses.
 *
 * Narrow deliberately. A real `Stripe` satisfies it structurally, and a test
 * supplies six lines instead of mocking a class tree — which is what makes the
 * checkout-parameter assertions below possible at all. It also states the
 * blast radius: two endpoints. Everything else Stripe can do is not reachable
 * from here.
 */
export interface StripeApi {
  readonly prices: { retrieve(id: string): Promise<{
    readonly active: boolean;
    readonly unit_amount: number | null;
    readonly currency: string;
    readonly recurring: { readonly interval: string; readonly interval_count: number } | null;
  }> };
  readonly subscriptions: { retrieve(id: string): Promise<{
    readonly cancel_at_period_end: boolean;
    readonly items: { readonly data: readonly {
      readonly current_period_end: number;
      readonly quantity?: number;
      readonly price: { readonly unit_amount: number | null; readonly currency: string; readonly recurring: { readonly interval: string; readonly interval_count: number } | null };
    }[] };
  }> };
  readonly checkout: {
    readonly sessions: {
      create(params: CheckoutSessionParams): Promise<{
        readonly url: string | null;
        readonly expires_at: number;
      }>;
    };
  };
  readonly billingPortal: {
    readonly sessions: {
      create(params: PortalSessionParams): Promise<{ readonly url: string }>;
    };
  };
}

export type CheckoutSessionParams = {
  mode: "subscription";
  line_items: { price: string; quantity: number }[];
  success_url: string;
  cancel_url: string;
  client_reference_id: string;
  metadata: Record<string, string>;
  subscription_data: { metadata: Record<string, string> };
  customer?: string;
};

export type PortalSessionParams = { customer: string; return_url: string };

export type StripeBillingConfig = {
  readonly api: StripeApi;
  /** The endpoint's signing secret, `whsec_…`. One per configured endpoint. */
  readonly webhookSecret: string;
  readonly prices: PlanPrices;
  /** How old a delivery may be. Defaults to Stripe's own five minutes. */
  readonly webhookTolerance?: Duration;
};

export const stripeBillingGateway = (
  config: StripeBillingConfig,
): BillingGateway<PlanId, BillingEvent> => ({
  async prices() {
    return Promise.all((Object.keys(config.prices) as (keyof PlanPrices)[]).flatMap((plan) =>
      (["monthly", "annual"] as const).map(async (cadence) => {
        const price = await call("read plan pricing", () => config.api.prices.retrieve(config.prices[plan][cadence]));
        if (!price.active || price.unit_amount === null || price.unit_amount < 0 ||
            price.recurring?.interval !== (cadence === "monthly" ? "month" : "year") ||
            price.recurring.interval_count !== 1) {
          throw new StripeProviderError("configured plan price is not an active fixed recurring price for this cadence");
        }
        return { plan, cadence, amount: price.unit_amount, currency: price.currency };
      }),
    ));
  },

  async subscriptionDetails(reference) {
    const subscription = await call("read subscription details", () => config.api.subscriptions.retrieve(reference));
    const item = subscription.items.data.length === 1 ? subscription.items.data[0] : undefined;
    const recurring = item?.price.recurring;
    return {
      cadence: recurring?.interval_count !== 1 ? null : recurring.interval === "month" ? "monthly" : recurring.interval === "year" ? "annual" : null,
      price: item?.price.unit_amount == null ? null : { amount: item.price.unit_amount * (item.quantity ?? 1), currency: item.price.currency },
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      periodEndsAt: item === undefined ? null : Instant.fromEpochMillis(item.current_period_end * 1000),
    };
  },

  async createCheckoutSession(request: CheckoutRequest<PlanId>): Promise<HostedSession> {
    const price = priceFor(config.prices, request.plan, request.cadence);
    if (price === null) {
      // Reachable because the port is generic over every plan id, and `free`
      // is one. You do not check out of a free plan; you arrive at it by
      // cancelling.
      throw new PlanUnavailableError(request.plan, "no Stripe price is configured for it");
    }

    const workspace = unbrand(request.workspace);
    const metadata: Record<string, string> = {
      [METADATA_WORKSPACE]: workspace,
      [METADATA_PLAN]: request.plan,
      [METADATA_CADENCE]: request.cadence,
    };

    const session = await call("create a checkout session", () =>
      config.api.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price, quantity: 1 }],
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        client_reference_id: workspace,
        metadata,
        // Copied onto the subscription, not just the session. Every later
        // `customer.subscription.*` event carries the subscription's metadata
        // and knows nothing about the session that created it — set this in
        // one place only and every renewal arrives unattributable.
        subscription_data: { metadata },
        // Omitted rather than sent as null for a first-time subscriber:
        // Stripe creates the customer, and sending an explicit null is a
        // parameter error.
        ...(request.customer === null ? {} : { customer: request.customer }),
      }),
    );

    if (session.url === null) {
      throw new StripeProviderError("checkout session was created without a URL");
    }

    return {
      url: session.url,
      expiresAt: Instant.fromEpochMillis(session.expires_at * 1000),
    };
  },

  async createPortalSession(request: PortalRequest): Promise<HostedSession> {
    const session = await call("create a billing portal session", () =>
      config.api.billingPortal.sessions.create({
        customer: request.customer,
        return_url: request.returnUrl,
      }),
    );

    // The portal session has no expiry field of its own — Stripe expires the
    // link on first use. Reporting null is honest; inventing a window is not.
    return { url: session.url, expiresAt: null };
  },

  verifyWebhook(
    body: string,
    signature: string | undefined,
    at: Instant,
  ): Result<VerifiedWebhook<BillingEvent>, WebhookRejection> {
    const verified = verifyStripeSignature({
      body,
      header: signature,
      secret: config.webhookSecret,
      at,
      ...(config.webhookTolerance === undefined ? {} : { tolerance: config.webhookTolerance }),
    });
    if (!verified.ok) return verified;

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (cause) {
      // Signed by us and not JSON should be impossible. Saying so as a value
      // rather than throwing keeps the whole webhook path exception-free.
      return err({ kind: "Malformed", detail: `signed body is not JSON: ${describe(cause)}` });
    }

    return translateStripeEvent(parsed, config.prices);
  },
});

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Every Stripe network call goes through here, so a provider failure has one
 * shape at the boundary instead of leaking `StripeInvalidRequestError` into a
 * route handler.
 */
const call = async <T>(what: string, operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (cause) {
    const status =
      typeof cause === "object" && cause !== null && "statusCode" in cause
        ? ((cause as { statusCode?: unknown }).statusCode as number | undefined) ?? null
        : null;
    throw new StripeProviderError(`failed to ${what}: ${describe(cause)}`, { status, cause });
  }
};
