/**
 * Start a plan change.
 *
 * The domain never changes a plan on its own say-so. A plan change is money
 * moving, so what this use case produces is a *hosted session* — a URL at the
 * payment provider — and the plan changes later, when the provider tells us it
 * did, through `recordBillingEvent`. Anything else would let the console grant
 * a paid entitlement without a payment.
 *
 * Which session depends on what the customer already has:
 *
 *   - no paid standing, asking for a paid plan  → checkout
 *   - already entitled to that plan             → the portal, to manage it
 *   - asking for free                           → the portal, to cancel
 *
 * The middle case matters: sending an existing subscriber to checkout again
 * creates a second subscription and charges them twice. The portal is where a
 * subscription is changed, and the provider owns proration.
 */

import { err, ok, type Result, type WorkspaceId } from "@counted/kernel";
import {
  PlanCatalog,
  Subscription,
  isPlanId,
  type BillingError,
  type PlanId,
} from "@counted/tenancy-domain";
import type { HostedSession } from "@counted/tenancy-ports";
import type { BillingGateway, SubscriptionRepository } from "./ports";

export type ChangePlanDeps = {
  readonly subscriptions: SubscriptionRepository;
  readonly billing: BillingGateway;
};

export type ChangePlanCommand = {
  readonly workspace: WorkspaceId;
  /** Unvalidated: it arrives from the wire, and an unknown plan is refused. */
  readonly plan: string;
  readonly cadence: "monthly" | "annual";
  readonly successUrl: string;
  readonly cancelUrl: string;
  /**
   * Where the provider's portal returns the browser to. Must be a page that
   * renders — v1 pointed it at a route that immediately redirected, so a
   * customer finishing in the portal landed on a redirect chain and often ended
   * up signed out.
   */
  readonly returnUrl: string;
};

export const changePlan = async (
  deps: ChangePlanDeps,
  command: ChangePlanCommand,
): Promise<Result<HostedSession, BillingError>> => {
  if (!isPlanId(command.plan)) return err({ kind: "PlanUnavailable", plan: command.plan });
  const target: PlanId = command.plan;

  const subscription = await deps.subscriptions.find(command.workspace);
  if (subscription === null) return err({ kind: "NoSubscription", workspace: command.workspace });

  const entitled = Subscription.entitlementOf(subscription).plan;
  const wantsPortal = !PlanCatalog.isPaid(target) || target === entitled;

  if (wantsPortal) {
    // Cancelling or managing both require a provider customer. A workspace that
    // has never been to checkout has nothing to manage — and asking the
    // provider for a portal session with a null customer is a 400 from them
    // rather than an answer for us.
    const customer = subscription.customer;
    if (customer === null) return err({ kind: "NoSubscription", workspace: command.workspace });

    return attempt(() =>
      deps.billing.createPortalSession({ customer, returnUrl: command.returnUrl }),
    );
  }

  return attempt(() =>
    deps.billing.createCheckoutSession({
      workspace: command.workspace,
      plan: target,
      cadence: command.cadence,
      customer: subscription.customer,
      successUrl: command.successUrl,
      cancelUrl: command.cancelUrl,
    }),
  );
};

/**
 * The gateway talks to somebody else's server, so it rejects rather than
 * returning a `Result`: a network failure is not a domain outcome. One place
 * turns it into one, so no route handler ever has to guess whether an unhandled
 * rejection here means "declined" or "Stripe is down".
 */
const attempt = async (
  call: () => Promise<HostedSession>,
): Promise<Result<HostedSession, BillingError>> => {
  try {
    return ok(await call());
  } catch (cause) {
    return err({ kind: "ProviderUnavailable", detail: describe(cause) });
  }
};

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
