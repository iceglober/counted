/**
 * Stripe's event vocabulary → the five things the domain says can happen.
 *
 * `BillingEvent` has five kinds. Stripe has several hundred event types. This
 * file is the whole of the translation, and it is a pure function of the
 * parsed body so every mapping is a test rather than a Stripe account and a
 * card.
 *
 * **Anything unrecognised becomes `event: null`, not an error.** The port
 * documents that as "recorded and acknowledged anyway, so the provider stops
 * retrying it" — Stripe retries a non-2xx for three days, and an endpoint that
 * 500s on every event type it does not handle spends those three days being
 * hammered while the ones it does handle queue up behind them.
 *
 * **`workspace` is best-effort and often null.** Metadata is present on
 * sessions and subscriptions and absent from most invoices. Null is not a
 * failure: `SubscriptionRepository.findBySubscriptionRef` exists precisely so
 * the app can resolve one from the subscription reference the event does
 * carry.
 */

import { isPlanId, type BillingEvent, type PlanId } from "@counted/tenancy-domain";
import { err, Instant, ok, WorkspaceId, isWorkspaceId, type Result } from "@counted/kernel";
import type { VerifiedWebhook, WebhookRejection } from "@counted/tenancy-ports";
import { METADATA_PLAN, METADATA_WORKSPACE } from "./metadata";
import { planForPrice, type PlanPrices } from "./plans";
import {
  asRecord,
  readList,
  readMetadata,
  readNumber,
  readRecord,
  readRef,
  readString,
} from "./read";

/**
 * Stripe subscription statuses, grouped by what they mean for entitlement.
 *
 * The grouping is the interesting part. `past_due` is deliberately NOT treated
 * as "not active": dropping a paying customer to free the moment a card expires
 * is a worse failure than carrying them for a cycle, and `Entitlement.resolve`
 * has an `inGrace` flag for exactly this. `unpaid` joins it because Stripe
 * reaches it by exhausting retries on a card that may still be fixed.
 */
const ENTITLED: ReadonlySet<string> = new Set(["active", "trialing"]);
const IN_ARREARS: ReadonlySet<string> = new Set(["past_due", "unpaid"]);
const FINISHED: ReadonlySet<string> = new Set(["canceled", "incomplete_expired"]);
// `incomplete` and `paused` are neither: the first is a checkout that has not
// been paid yet (the session event will arrive), the second is a state we
// never put a subscription into.

export const translateStripeEvent = (
  raw: unknown,
  prices: PlanPrices,
): Result<VerifiedWebhook<BillingEvent>, WebhookRejection> => {
  const envelope = asRecord(raw);
  const id = readString(envelope, "id");
  const type = readString(envelope, "type");

  if (id === null || type === null) {
    return err({ kind: "Malformed", detail: "event has no id or type" });
  }

  const object = readRecord(readRecord(envelope, "data"), "object");
  if (object === null) {
    return err({ kind: "Malformed", detail: `event ${type} has no data.object` });
  }

  return ok({ id, type, workspace: workspaceOf(object), event: eventOf(type, object, prices) });
};

/**
 * The workspace, if the object carries one.
 *
 * Validated through `isWorkspaceId` rather than branded blindly: metadata is
 * editable in the Stripe dashboard, so this string is user input by a longer
 * route than usual.
 */
const workspaceOf = (object: Record<string, unknown>) => {
  const metadata = readMetadata(object);
  const raw =
    metadata[METADATA_WORKSPACE] ??
    // A checkout session may carry it as client_reference_id instead, which is
    // what a Stripe payment link sets when it has nowhere else to put it.
    readString(object, "client_reference_id") ??
    // An invoice has no metadata of its own worth reading, but it snapshots
    // the subscription's at finalisation.
    readMetadata(readRecord(readRecord(object, "parent"), "subscription_details"))[
      METADATA_WORKSPACE
    ];

  return raw !== undefined && isWorkspaceId(raw) ? WorkspaceId(raw) : null;
};

const eventOf = (
  type: string,
  object: Record<string, unknown>,
  prices: PlanPrices,
): BillingEvent | null => {
  switch (type) {
    case "checkout.session.completed":
      return checkoutCompleted(object);

    // `created` and `updated` are translated identically. The domain's
    // transition is a function of (state, event) and is idempotent, so the
    // distinction Stripe draws — did this subscription exist a moment ago —
    // does not change what we do with it.
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return subscriptionChanged(object, prices);

    case "customer.subscription.deleted":
      return canceled(object);

    case "invoice.payment_failed":
      return paymentFailed(object);

    // `invoice.paid` and `invoice.payment_succeeded` both fire for the same
    // invoice. Handling both is safe — the ledger deduplicates by event id and
    // the transition is idempotent — and handling only one means a Stripe
    // account configured to send the other silently never recovers a customer
    // out of grace.
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return paymentRecovered(object);

    default:
      return null;
  }
};

const checkoutCompleted = (session: Record<string, unknown>): BillingEvent | null => {
  // A setup-mode or payment-mode session is not a subscription starting.
  if (readString(session, "mode") !== "subscription") return null;

  // `checkout.session.completed` fires when the session completes, which is not
  // the same as the money arriving: a delayed payment method leaves
  // payment_status `unpaid` and can still fail. Granting the plan there is how
  // you comp a subscription to someone whose bank later declines.
  const paymentStatus = readString(session, "payment_status");
  if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") return null;

  const customer = readRef(session, "customer");
  const subscription = readRef(session, "subscription");
  const plan = planFromMetadata(readMetadata(session));

  if (customer === null || subscription === null || plan === null) return null;

  return {
    kind: "checkout_completed",
    plan,
    customer,
    subscription,
    // A session carries no period end. The `customer.subscription.*` event for
    // the same checkout does, and sets it.
    renewsAt: null,
  };
};

const subscriptionChanged = (
  subscription: Record<string, unknown>,
  prices: PlanPrices,
): BillingEvent | null => {
  const ref = readString(subscription, "id");
  if (ref === null) return null;

  const status = readString(subscription, "status");
  if (status === null) return null;

  if (FINISHED.has(status)) return { kind: "subscription_canceled", subscription: ref };

  // A card problem, not a cancellation. Reported as a payment failure so the
  // domain keeps the plan and marks the customer in grace.
  if (IN_ARREARS.has(status)) return { kind: "payment_failed", subscription: ref };

  if (!ENTITLED.has(status)) return null;

  const plan = planOfSubscription(subscription, prices);
  // Active on a price we do not recognise. There is no safe guess: naming the
  // wrong plan hands out entitlements nobody paid for, and defaulting to free
  // takes away ones somebody did.
  if (plan === null) return null;

  return {
    kind: "subscription_updated",
    plan,
    subscription: ref,
    renewsAt: renewalOf(subscription),
    active: true,
  };
};

const canceled = (subscription: Record<string, unknown>): BillingEvent | null => {
  const ref = readString(subscription, "id");
  return ref === null ? null : { kind: "subscription_canceled", subscription: ref };
};

const paymentFailed = (invoice: Record<string, unknown>): BillingEvent | null => {
  const ref = subscriptionOfInvoice(invoice);
  // A one-off invoice with no subscription parent says nothing about a plan.
  return ref === null ? null : { kind: "payment_failed", subscription: ref };
};

const paymentRecovered = (invoice: Record<string, unknown>): BillingEvent | null => {
  const ref = subscriptionOfInvoice(invoice);
  return ref === null ? null : { kind: "payment_recovered", subscription: ref };
};

/**
 * The subscription an invoice belongs to.
 *
 * NOT `invoice.subscription`. That field was removed: since the 2025 API
 * versions it is `invoice.parent.subscription_details.subscription`, and the
 * old spelling is simply absent — reading it yields undefined, and every
 * renewal and every failed payment silently stops being attributable. Checked
 * against the types shipped with stripe@22.6.0 (API 2026-08-26.dahlia). The
 * old path is still read as a fallback so an account pinned to an older
 * version keeps working.
 */
const subscriptionOfInvoice = (invoice: Record<string, unknown>): string | null =>
  readRef(readRecord(readRecord(invoice, "parent"), "subscription_details"), "subscription") ??
  readRef(invoice, "subscription");

/**
 * When the paid period lapses.
 *
 * NOT `subscription.current_period_end`. That field moved off the subscription
 * and onto each subscription item, so the obvious read returns undefined and
 * every renewal date silently becomes null. The earliest item's end is the
 * conservative reading — it is the first moment any part of the subscription
 * needs paying for again.
 */
const renewalOf = (subscription: Record<string, unknown>): Instant | null => {
  const ends = readList(subscription, "items")
    .map((item) => readNumber(item, "current_period_end"))
    .filter((value): value is number => value !== null);

  if (ends.length === 0) {
    const legacy = readNumber(subscription, "current_period_end");
    return legacy === null ? null : Instant.fromEpochMillis(legacy * 1000);
  }

  return Instant.fromEpochMillis(Math.min(...ends) * 1000);
};

/**
 * Which plan a subscription is on.
 *
 * Metadata first, price id second. The metadata is what we wrote at checkout
 * and it survives a price being archived and replaced — which happens every
 * time the price of Pro changes, because a Stripe price is immutable.
 */
const planOfSubscription = (
  subscription: Record<string, unknown>,
  prices: PlanPrices,
): PlanId | null => {
  const fromMetadata = planFromMetadata(readMetadata(subscription));
  if (fromMetadata !== null) return fromMetadata;

  for (const item of readList(subscription, "items")) {
    const priceId = readRef(item, "price");
    if (priceId === null) continue;
    const plan = planForPrice(prices, priceId);
    if (plan !== null) return plan;
  }
  return null;
};

const planFromMetadata = (metadata: Record<string, string>): PlanId | null => {
  const raw = metadata[METADATA_PLAN];
  return raw !== undefined && isPlanId(raw) ? raw : null;
};
