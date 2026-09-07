/**
 * Apply a payment-provider webhook, once.
 *
 * The whole flow lives here — verify, deduplicate, transition, adopt — because
 * splitting it is how the pieces drift apart. The route that calls it does one
 * thing: hand over the raw bytes and the signature header. It must be the raw
 * bytes, not a parsed object: the signature is computed over the body exactly
 * as sent, and re-serialising JSON changes it. That is why the webhook route
 * stays hand-written instead of going through oRPC.
 *
 * **Delivery is at-least-once and the provider retries for days.** The ledger
 * claim is what makes a redelivery a no-op; `Workspace.applyStanding` emitting
 * nothing when nothing changed is the second line of defence, so even a claim
 * that is lost cannot produce a duplicate "your payment failed" email.
 *
 * **Everything that is not an error is acknowledged.** An event we do not act
 * on, and an event about a workspace we cannot identify, both return `ignored`
 * — 200 back to the provider. Retrying will not make an unknown customer known,
 * and a stuck webhook queue is a worse outage than a dropped notification.
 */

import { assertNever, err, isErr, ok, type Instant, type Result } from "@counted/kernel";
import type { MembershipDirectory } from "@counted/identity-ports";
import {
  Subscription,
  applyBillingEvent,
  type BillingError,
  type BillingEvent,
  type Transition,
} from "@counted/tenancy-domain";
import type { VerifiedWebhook, WebhookRejection } from "@counted/tenancy-ports";
import type {
  BillingGateway,
  SubscriptionRepository,
  WebhookLedger,
  WorkspaceRepository,
} from "./ports";

export type RecordBillingEventDeps = {
  readonly billing: BillingGateway;
  readonly workspaces: WorkspaceRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly memberships: MembershipDirectory;
  readonly ledger: WebhookLedger;
};

export type WebhookRequest = {
  readonly body: string;
  readonly signature: string | undefined;
};

export type BillingOutcome =
  | { readonly kind: "applied"; readonly transition: Transition }
  /** Already claimed by an earlier delivery. Nothing was written. */
  | { readonly kind: "duplicate"; readonly event: string }
  | {
      readonly kind: "ignored";
      /**
       * `not_actionable` — a provider event we do not translate.
       * `unknown_workspace` — verified, but nothing here matches it.
       */
      readonly reason: "not_actionable" | "unknown_workspace";
      readonly event: string;
    };

export const recordBillingEvent = async (
  deps: RecordBillingEventDeps,
  request: WebhookRequest,
  at: Instant,
): Promise<Result<BillingOutcome, BillingError>> => {
  const verification = deps.billing.verifyWebhook(request.body, request.signature, at);
  if (isErr(verification)) return err(fromWebhookRejection(verification.error));

  const verified = verification.value;

  const claimed = await deps.ledger.claim(verified.id, verified.type, at);
  if (!claimed) return ok({ kind: "duplicate", event: verified.id });

  const acknowledge = async (
    reason: "not_actionable" | "unknown_workspace",
  ): Promise<Result<BillingOutcome, BillingError>> => {
    await deps.ledger.markProcessed(verified.id, at);
    return ok({ kind: "ignored", reason, event: verified.id });
  };

  const event = verified.event;
  if (event === null) return acknowledge("not_actionable");

  const current = await locate(deps, verified, event, at);
  if (current === null) return acknowledge("unknown_workspace");

  const workspace = await deps.workspaces.find(current.workspace);
  if (workspace === null) return acknowledge("unknown_workspace");

  const transition = applyBillingEvent(current, event, at);
  await deps.subscriptions.save(transition.subscription);

  // The seat count is better-auth's to know, and it is read at the moment the
  // limits change rather than kept here — a copy would be one more thing that
  // can be stale when a downgrade asks whether the workspace is over its seats.
  const seats = (await deps.memberships.membersOf(workspace.id)).length;
  const applied = workspace.applyStanding(
    Subscription.standingOf(transition.subscription),
    { seats },
    at,
  );
  await deps.workspaces.save(applied.workspace, applied.events);

  await deps.ledger.markProcessed(verified.id, at);
  return ok({ kind: "applied", transition });
};

/**
 * Find the subscription this event is about, three ways, in order of certainty.
 *
 * The last resort is the one that matters: when the workspace is known but no
 * subscription row exists, this returns a fresh free-plan one rather than
 * nothing. That is the first-time subscriber, and it is the case v1 got wrong —
 * its `UPDATE … WHERE user_id` matched zero rows and reported success.
 */
const locate = async (
  deps: RecordBillingEventDeps,
  verified: VerifiedWebhook<BillingEvent>,
  event: BillingEvent,
  at: Instant,
): Promise<Subscription | null> => {
  const byRef = await deps.subscriptions.findBySubscriptionRef(event.subscription);
  if (byRef !== null) return byRef;

  if (event.kind === "checkout_completed") {
    const byCustomer = await deps.subscriptions.findByCustomer(event.customer);
    if (byCustomer !== null) return byCustomer;
  }

  if (verified.workspace === null) return null;
  const byWorkspace = await deps.subscriptions.find(verified.workspace);
  return byWorkspace ?? Subscription.none(verified.workspace, at);
};

/**
 * The ports' rejection vocabulary, in the domain's.
 *
 * One function, so the two unions can only drift in a place the compiler is
 * looking at.
 */
export const fromWebhookRejection = (rejection: WebhookRejection): BillingError => {
  switch (rejection.kind) {
    case "BadSignature":
      return { kind: "BadSignature" };
    case "Stale":
      return { kind: "Stale", ageSeconds: rejection.ageSeconds };
    case "Malformed":
      return { kind: "Malformed", detail: rejection.detail };
    default:
      return assertNever(rejection);
  }
};
