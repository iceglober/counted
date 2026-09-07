/**
 * The metadata we attach to Stripe objects, and read back off webhooks.
 *
 * Stripe has no idea what a workspace is. These keys are how a payment object
 * carries the one fact the domain needs to route it. Written on the checkout
 * session *and* on `subscription_data`, because a session is a one-time thing
 * and every later `customer.subscription.*` event carries the subscription's
 * metadata, not the session's — set it in only one place and every renewal,
 * cancellation and card failure arrives unattributable.
 *
 * Prefixed, because metadata is a flat shared namespace: Stripe Tax, Checkout
 * and half the app marketplace write into it too.
 */

/** The `WorkspaceId` this payment object belongs to. */
export const METADATA_WORKSPACE = "counted_workspace";

/** The `PlanId` that was bought, so a plan survives a price id being replaced. */
export const METADATA_PLAN = "counted_plan";

/** `"monthly" | "annual"`. Recorded for support and reporting, never for entitlement. */
export const METADATA_CADENCE = "counted_cadence";
