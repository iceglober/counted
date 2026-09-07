import { describe, expect, test } from "bun:test";
import { Instant, isErr, isOk, WorkspaceId } from "@counted/kernel";
import type { BillingEvent } from "@counted/tenancy-domain";
import { translateStripeEvent } from "./translate";
import type { PlanPrices } from "./plans";

const PRICES: PlanPrices = {
  pro: { monthly: "price_pro_monthly", annual: "price_pro_annual" },
};

const PERIOD_END = 1_767_225_600; // unix seconds

const envelope = (type: string, object: unknown) => ({
  id: "evt_test",
  object: "event",
  type,
  data: { object },
});

const subscription = (over: Record<string, unknown> = {}) => ({
  id: "sub_123",
  object: "subscription",
  status: "active",
  customer: "cus_123",
  metadata: { counted_workspace: "ws_1", counted_plan: "pro" },
  items: {
    object: "list",
    data: [{ id: "si_1", price: { id: "price_pro_monthly" }, current_period_end: PERIOD_END }],
  },
  ...over,
});

const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_123",
  object: "checkout.session",
  mode: "subscription",
  payment_status: "paid",
  customer: "cus_123",
  subscription: "sub_123",
  client_reference_id: "ws_1",
  metadata: { counted_workspace: "ws_1", counted_plan: "pro", counted_cadence: "monthly" },
  ...over,
});

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "in_123",
  object: "invoice",
  parent: {
    type: "subscription_details",
    subscription_details: {
      subscription: "sub_123",
      metadata: { counted_workspace: "ws_1" },
    },
  },
  ...over,
});

const translate = (type: string, object: unknown) => translateStripeEvent(envelope(type, object), PRICES);

const eventOf = (type: string, object: unknown): BillingEvent | null => {
  const result = translate(type, object);
  if (!isOk(result)) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.value.event;
};

describe("the envelope", () => {
  test("a body with no id or type is malformed", () => {
    expect(isErr(translateStripeEvent({ object: "event" }, PRICES))).toBe(true);
    expect(isErr(translateStripeEvent("not an object", PRICES))).toBe(true);
  });

  test("an event with no data.object is malformed", () => {
    expect(isErr(translateStripeEvent({ id: "evt", type: "invoice.paid" }, PRICES))).toBe(true);
  });

  test("the provider's id and type survive even when we do not act on the event", () => {
    // They are the idempotency key and the audit row. An unhandled event still
    // has to be recorded and acknowledged or Stripe retries it for three days.
    const result = translate("radar.early_fraud_warning.created", { id: "issfr_1" });
    expect(isOk(result) && result.value).toMatchObject({
      id: "evt_test",
      type: "radar.early_fraud_warning.created",
      event: null,
    });
  });
});

describe("checkout.session.completed", () => {
  test("becomes checkout_completed with the plan from metadata", () => {
    expect(eventOf("checkout.session.completed", session())).toEqual({
      kind: "checkout_completed",
      plan: "pro",
      customer: "cus_123",
      subscription: "sub_123",
      renewsAt: null,
    });
  });

  test("an unpaid session grants nothing", () => {
    // The event fires when the session completes, not when the money arrives.
    // A delayed payment method can still fail; granting the plan here comps a
    // subscription to someone whose bank later declines.
    expect(eventOf("checkout.session.completed", session({ payment_status: "unpaid" }))).toBeNull();
  });

  test("a trial with nothing to pay is still a completed checkout", () => {
    expect(
      eventOf("checkout.session.completed", session({ payment_status: "no_payment_required" })),
    ).toMatchObject({ kind: "checkout_completed" });
  });

  test("a setup-mode session is not a subscription starting", () => {
    expect(eventOf("checkout.session.completed", session({ mode: "setup" }))).toBeNull();
  });

  test("an unrecognised plan in metadata grants nothing", () => {
    // Metadata is editable in the Stripe dashboard.
    expect(
      eventOf("checkout.session.completed", session({ metadata: { counted_plan: "enterprise" } })),
    ).toBeNull();
  });
});

describe("customer.subscription.created / updated", () => {
  test("an active subscription reports its plan and renewal", () => {
    expect(eventOf("customer.subscription.updated", subscription())).toEqual({
      kind: "subscription_updated",
      plan: "pro",
      subscription: "sub_123",
      renewsAt: Instant.fromEpochMillis(PERIOD_END * 1000),
      active: true,
    });
  });

  test("created and updated translate identically", () => {
    expect(eventOf("customer.subscription.created", subscription())).toEqual(
      eventOf("customer.subscription.updated", subscription()) as BillingEvent,
    );
  });

  test("the renewal comes off the item, not the subscription", () => {
    // `current_period_end` moved off Subscription and onto SubscriptionItem.
    // Reading the old path returns undefined and every renewal date silently
    // becomes null — the sort of bug nobody notices until a renewal banner
    // never appears.
    const noItemPeriod = subscription({
      items: { object: "list", data: [{ id: "si_1", price: { id: "price_pro_monthly" } }] },
    });
    expect((eventOf("customer.subscription.updated", noItemPeriod) as { renewsAt: unknown }).renewsAt).toBeNull();
  });

  test("with several items the earliest period end wins", () => {
    const multi = subscription({
      items: {
        object: "list",
        data: [
          { id: "si_1", price: { id: "price_pro_annual" }, current_period_end: PERIOD_END },
          { id: "si_2", price: { id: "price_pro_monthly" }, current_period_end: PERIOD_END - 900 },
        ],
      },
    });
    expect((eventOf("customer.subscription.updated", multi) as { renewsAt: Instant }).renewsAt).toEqual(
      Instant.fromEpochMillis((PERIOD_END - 900) * 1000),
    );
  });

  test("the plan falls back to the price id when metadata is absent", () => {
    // A Stripe price is immutable, so changing what Pro costs means a new id.
    // Metadata survives that; the price id does not — hence metadata first.
    const noMetadata = subscription({ metadata: {} });
    expect(eventOf("customer.subscription.updated", noMetadata)).toMatchObject({ plan: "pro" });
  });

  test("an active subscription on a price we do not recognise grants nothing", () => {
    // There is no safe guess: naming the wrong plan hands out entitlements
    // nobody paid for, and defaulting to free takes away ones somebody did.
    const unknown = subscription({
      metadata: {},
      items: { object: "list", data: [{ id: "si_1", price: { id: "price_legacy_2019" } }] },
    });
    expect(eventOf("customer.subscription.updated", unknown)).toBeNull();
  });

  test("past_due is a payment failure, not a cancellation", () => {
    // Dropping a paying customer to free the moment a card expires is worse
    // than carrying them a cycle. `Entitlement.inGrace` exists for this.
    expect(eventOf("customer.subscription.updated", subscription({ status: "past_due" }))).toEqual({
      kind: "payment_failed",
      subscription: "sub_123",
    });
    expect(eventOf("customer.subscription.updated", subscription({ status: "unpaid" }))).toEqual({
      kind: "payment_failed",
      subscription: "sub_123",
    });
  });

  test("a canceled or expired subscription cancels, even on an unknown price", () => {
    // The plan is irrelevant to a cancellation, so an unrecognised price must
    // not stop us acting on one.
    const unknownPrice = { metadata: {}, items: { object: "list", data: [] } };
    expect(
      eventOf("customer.subscription.updated", subscription({ status: "canceled", ...unknownPrice })),
    ).toEqual({ kind: "subscription_canceled", subscription: "sub_123" });
    expect(
      eventOf("customer.subscription.updated", subscription({ status: "incomplete_expired" })),
    ).toEqual({ kind: "subscription_canceled", subscription: "sub_123" });
  });

  test("an incomplete subscription is not acted on", () => {
    // Checkout has not been paid; the session event will arrive.
    expect(eventOf("customer.subscription.updated", subscription({ status: "incomplete" }))).toBeNull();
  });

  test("a cancellation scheduled for period end does not cancel yet", () => {
    // The customer has paid through the period. `customer.subscription.deleted`
    // arrives when it actually lapses.
    expect(
      eventOf("customer.subscription.updated", subscription({ cancel_at_period_end: true })),
    ).toMatchObject({ kind: "subscription_updated", active: true });
  });
});

describe("customer.subscription.deleted", () => {
  test("cancels", () => {
    expect(eventOf("customer.subscription.deleted", subscription({ status: "canceled" }))).toEqual({
      kind: "subscription_canceled",
      subscription: "sub_123",
    });
  });
});

describe("invoice events", () => {
  test("a failed payment names the subscription from parent.subscription_details", () => {
    // NOT `invoice.subscription` — that field was removed. Reading the old
    // spelling yields undefined and every failed payment stops being
    // attributable, silently.
    expect(eventOf("invoice.payment_failed", invoice())).toEqual({
      kind: "payment_failed",
      subscription: "sub_123",
    });
  });

  test("the pre-2025 invoice.subscription spelling still works", () => {
    const legacy = { id: "in_9", object: "invoice", subscription: "sub_123" };
    expect(eventOf("invoice.payment_failed", legacy)).toEqual({
      kind: "payment_failed",
      subscription: "sub_123",
    });
  });

  test("both success spellings recover the customer", () => {
    // An account configured to send only one of these would otherwise never
    // bring a customer back out of grace.
    for (const type of ["invoice.paid", "invoice.payment_succeeded"]) {
      expect(eventOf(type, invoice())).toEqual({
        kind: "payment_recovered",
        subscription: "sub_123",
      });
    }
  });

  test("a one-off invoice with no subscription is not acted on", () => {
    expect(eventOf("invoice.paid", { id: "in_1", object: "invoice" })).toBeNull();
  });
});

describe("the workspace", () => {
  test("comes from metadata when present", () => {
    const result = translate("customer.subscription.updated", subscription());
    expect(isOk(result) && result.value.workspace).toEqual(WorkspaceId("ws_1"));
  });

  test("falls back to client_reference_id on a session", () => {
    const result = translate(
      "checkout.session.completed",
      session({ metadata: { counted_plan: "pro" } }),
    );
    expect(isOk(result) && result.value.workspace).toEqual(WorkspaceId("ws_1"));
  });

  test("is read off an invoice's snapshotted subscription metadata", () => {
    const result = translate("invoice.paid", invoice());
    expect(isOk(result) && result.value.workspace).toEqual(WorkspaceId("ws_1"));
  });

  test("is null when nothing carries it, and that is not an error", () => {
    // `SubscriptionRepository.findBySubscriptionRef` exists exactly so the app
    // can resolve one from the subscription reference the event does carry.
    const result = translate("invoice.paid", { id: "in_1", object: "invoice", subscription: "sub_9" });
    expect(isOk(result) && result.value.workspace).toBeNull();
    expect(isOk(result) && result.value.event).toEqual({
      kind: "payment_recovered",
      subscription: "sub_9",
    });
  });

  test("a metadata value that is not a usable id is refused rather than branded", () => {
    // Metadata is editable in the dashboard, so this string is user input by a
    // longer route than usual.
    const result = translate(
      "customer.subscription.updated",
      subscription({ metadata: { counted_workspace: "  ", counted_plan: "pro" } }),
    );
    expect(isOk(result) && result.value.workspace).toBeNull();
  });
});

describe("expanded references", () => {
  test("a customer sent as an object rather than an id still resolves", () => {
    // Every Stripe association is `"cus_1"` or `{ id: "cus_1", … }` depending
    // on expansion, and which one arrives is not under our control.
    expect(
      eventOf("checkout.session.completed", session({ customer: { id: "cus_777", object: "customer" } })),
    ).toMatchObject({ customer: "cus_777" });
  });
});
