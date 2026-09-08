/**
 * Talking to the payment provider, and remembering what it told us.
 *
 * Stripe never decides an entitlement. It reports payment state; the domain
 * decides what that entitles a workspace to. v1 kept its plan catalog inside
 * `lib/stripe.ts`, which is how "is this customer on Pro?" ended up with three
 * different answers in three files.
 *
 * The type parameters follow the same convention as the repositories: `PlanId`
 * and `BillingEvent` belong to `@counted/tenancy-domain`, and the gateway does
 * not need to know what is in them — it needs to name a plan to the provider
 * and hand back a translated event.
 */

import type { Instant, Result, WorkspaceId } from "@counted/kernel";

export type HostedSession = {
  /** Where to send the browser. Short-lived, provider-issued. */
  readonly url: string;
  readonly expiresAt: Instant | null;
};

export type CheckoutRequest<PlanId extends string> = {
  readonly workspace: WorkspaceId;
  readonly plan: PlanId;
  readonly cadence: "monthly" | "annual";
  /** An existing provider customer, when this workspace has checked out before. */
  readonly customer: string | null;
  readonly successUrl: string;
  readonly cancelUrl: string;
};

export type PortalRequest = {
  readonly customer: string;
  /**
   * Where the provider sends the browser back to.
   *
   * Must be a page that *renders*, not one that redirects. v1 pointed this at
   * a route that immediately bounced elsewhere, so a customer finishing in the
   * portal landed on a redirect chain and often ended up signed out.
   */
  readonly returnUrl: string;
};

/** A webhook that has been verified and translated into our vocabulary. */
export type VerifiedWebhook<BillingEvent> = {
  /** The provider's event id. The idempotency key. */
  readonly id: string;
  /** The provider's own type string, kept for logging and the audit row. */
  readonly type: string;
  /** Which workspace it concerns, if we can tell. */
  readonly workspace: WorkspaceId | null;
  /**
   * Null when the event is one we do not act on. Recorded and acknowledged
   * anyway, so the provider stops retrying it.
   */
  readonly event: BillingEvent | null;
};

export type WebhookRejection =
  | { readonly kind: "BadSignature" }
  | { readonly kind: "Stale"; readonly ageSeconds: number }
  | { readonly kind: "Malformed"; readonly detail: string };

export interface BillingGateway<PlanId extends string, BillingEvent> {
  /** Public prices from the configured provider; no price ids reach clients. */
  prices(): Promise<readonly BillingPrice<PlanId>[]>;
  /** Provider display details never grant an entitlement. Webhooks do that. */
  subscriptionDetails(reference: string): Promise<BillingSubscriptionDetails>;
  createCheckoutSession(request: CheckoutRequest<PlanId>): Promise<HostedSession>;

  createPortalSession(request: PortalRequest): Promise<HostedSession>;

  /**
   * Verify a raw request body against its signature header, then translate.
   *
   * Takes the **raw bytes**, not a parsed object: a signature is computed over
   * the body exactly as sent, and re-serialising JSON changes it. This is one
   * of the three routes that stays hand-written rather than going through oRPC,
   * for precisely this reason.
   */
  verifyWebhook(
    body: string,
    signature: string | undefined,
    at: Instant,
  ): Result<VerifiedWebhook<BillingEvent>, WebhookRejection>;
}

export type BillingPrice<PlanId extends string> = {
  readonly plan: PlanId;
  readonly cadence: "monthly" | "annual";
  /** The provider's smallest currency unit. */
  readonly amount: number;
  readonly currency: string;
};

export type BillingSubscriptionDetails = {
  readonly cadence: "monthly" | "annual" | null;
  /** Base recurring line amount; final invoices may include tax or discounts. */
  readonly price: { readonly amount: number; readonly currency: string } | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly periodEndsAt: Instant | null;
};

/**
 * Where a workspace's paid standing lives.
 *
 * `save` is an upsert by design. There is no update-shaped method, because that
 * is the shape of the bug: v1's `UPDATE … WHERE user_id` matched nothing for
 * every first-time subscriber and reported success.
 */
export interface SubscriptionRepository<Subscription> {
  find(workspace: WorkspaceId): Promise<Subscription | null>;
  findByCustomer(customer: string): Promise<Subscription | null>;
  findBySubscriptionRef(subscription: string): Promise<Subscription | null>;
  save(subscription: Subscription): Promise<void>;
}

/**
 * Which provider events we have already acted on.
 *
 * Stripe delivers at-least-once and retries for days. Without this, a retried
 * `checkout.session.completed` is applied twice — harmless for an idempotent
 * transition, not harmless for the outbox message that goes with it.
 */
export interface WebhookLedger {
  /**
   * Record an event as seen. Returns false if it was already there, in which
   * case the caller acknowledges and does nothing.
   */
  claim(id: string, type: string, at: Instant): Promise<boolean>;
  markProcessed(id: string, at: Instant): Promise<void>;
}
