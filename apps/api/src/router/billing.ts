/**
 * Billing: plans, the subscription, and the two hosted sessions.
 *
 * These four procedures existed in `@counted/contract` and were never added to
 * the contract tree, so `openapi.json` did not describe them and this server
 * did not answer them — `POST /v1/workspaces/{id}/billing/checkout` was a 404.
 * The Stripe webhook was mounted and could grant a plan; nothing could start
 * the payment that produces the webhook, so no customer could ever upgrade.
 * `faults.ts` recorded the gap as six billing reasons no route declared.
 *
 * **Counted never sees a card number, which is why no route here takes one.**
 * Both write routes return a URL at the provider and change nothing: the plan
 * moves later, when the provider says it did, through `recordBillingEvent` on
 * the webhook. A route that granted the entitlement itself would be a paid plan
 * handed out by a button.
 *
 * `changePlan` picks checkout or the portal, and the choice is not this
 * layer's: an existing subscriber sent back to checkout is charged twice. So
 * `checkout` and `portal` are two contract routes over one use case, and the
 * use case decides — `portal` names its intent by asking for the plan the
 * workspace already has.
 *
 * **A deployment with no payment provider answers 502, not 501.**
 * `deps.billing` is null when `STRIPE_*` is unset, which is a configuration
 * state of this installation rather than a missing capability of the product —
 * and `ProviderUnavailable` is the one reason the contract declares that says
 * "the money side is not answering", which is exactly true.
 */

import { PlanCatalog, Subscription } from "@counted/tenancy-domain";
import { Instant } from "@counted/kernel";
import { changePlan } from "@counted/tenancy-app";
import { fromBillingError, raise } from "../faults";
import * as serialize from "../serialize";
import type { HandlerDeps } from "./deps";
import { locatedWorkspace, orBillingFault } from "./support";

export const billingRoutes = ({ deps, guarded }: HandlerDeps) => {
  /** The gateway, or the 502 that says this installation has no provider. */
  const gateway = () => {
    if (deps.billing === null) {
      raise(
        fromBillingError({
          kind: "ProviderUnavailable",
          detail: "no payment provider is configured for this installation",
        }),
      );
    }
    return deps.billing;
  };

  return {
    plans: guarded.billing.plans.handler(async ({ context }) => {
      const workspace = locatedWorkspace(context.authority.located);
      const found = await deps.reads.workspaces.find(workspace);
      if (found === null) {
        raise(fromBillingError({ kind: "NoSubscription", workspace }));
      }
      // The plan the workspace *gets*, not the one it bought: a past-due Pro
      // workspace on the free entitlement should see Pro as the upgrade it is
      // failing to pay for, and `entitlement` is the one answer to that.
      const base = { items: PlanCatalog.all().map(serialize.plan), current: found.entitlement.plan };
      if (deps.billing === null) return { ...base, pricing: "unconfigured" as const, prices: [] };
      try {
        return { ...base, pricing: "available" as const, prices: [...await deps.billing.prices()] };
      } catch {
        return { ...base, pricing: "unavailable" as const, prices: [] };
      }
    }),

    subscription: guarded.billing.subscription.handler(async ({ context }) => {
      const workspace = locatedWorkspace(context.authority.located);
      const found = await deps.reads.subscriptions.find(workspace);
      if (found === null) {
        // Every workspace gets a free-plan subscription row at provisioning,
        // so this is a half-finished creation rather than an unpaid customer.
        raise(fromBillingError({ kind: "NoSubscription", workspace }));
      }
      const base = { subscription: serialize.subscription(found), billingAvailable: deps.billing !== null };
      if (deps.billing === null || found.subscription === null || found.payment === "canceled" || found.payment === "none") return { ...base, details: null, detailsUnavailable: false };
      try {
        const details = await deps.billing.subscriptionDetails(found.subscription);
        return { ...base, details: { ...details, periodEndsAt: details.periodEndsAt === null ? null : Instant.toISO(details.periodEndsAt) }, detailsUnavailable: false };
      } catch {
        return { ...base, details: null, detailsUnavailable: true };
      }
    }),

    checkout: guarded.billing.checkout.handler(async ({ input, context }) => {
      const workspace = locatedWorkspace(context.authority.located);
      const session = orBillingFault(
        await changePlan(
          { subscriptions: deps.reads.subscriptions, billing: gateway() },
          {
            workspace,
            plan: input.plan,
            cadence: input.cadence,
            successUrl: input.successUrl,
            cancelUrl: input.cancelUrl,
            // A customer who is already on this plan is sent to the portal
            // instead, and the portal needs somewhere to return to. Reusing the
            // success URL is truthful: it is the page the caller nominated for
            // "you are done here".
            returnUrl: input.successUrl,
          },
        ),
      );
      return { session: serialize.hostedSession(session) };
    }),

    portal: guarded.billing.portal.handler(async ({ input, context }) => {
      const workspace = locatedWorkspace(context.authority.located);
      const current = await deps.reads.subscriptions.find(workspace);
      if (current === null) {
        raise(fromBillingError({ kind: "NoSubscription", workspace }));
      }

      /**
       * Asking for the plan the workspace already holds is what makes
       * `changePlan` open the portal rather than a second checkout. Stated here
       * rather than by calling a portal-only function, because the rule "an
       * existing subscriber never goes back to checkout" is worth having in
       * exactly one place.
       */
      const session = orBillingFault(
        await changePlan(
          { subscriptions: deps.reads.subscriptions, billing: gateway() },
          {
            workspace,
            plan: Subscription.entitlementOf(current).plan,
            cadence: "monthly",
            successUrl: input.returnUrl,
            cancelUrl: input.returnUrl,
            returnUrl: input.returnUrl,
          },
        ),
      );
      return { session: serialize.hostedSession(session) };
    }),
  };
};
