/**
 * Billing: usage, subscription, hosted sessions, and the Stripe webhook.
 *
 * The webhook is the important one. Its job is to take what the provider says
 * about payment and let the domain decide what that entitles a workspace to —
 * never the other way round.
 *
 * Three things it does that v1 did not:
 *
 *   **Upserts.** v1 ran `UPDATE subscriptions … WHERE user_id`, which matched
 *   zero rows for every first-time subscriber, reported success, and left a
 *   paying customer on the free plan. There is no update-shaped operation
 *   here; `save` is an upsert and always writes a row.
 *
 *   **Deduplicates.** Stripe delivers at-least-once and retries for days. A
 *   replayed event is acknowledged and skipped.
 *
 *   **Acknowledges what it ignores.** An event we do not act on gets a 200, so
 *   Stripe stops retrying it, and a log line, so we can see it happening.
 */

import {
  Instant,
  Quota,
  Subscription,
  WorkspaceId,
  applyBillingEvent,
} from "@counted/domain";
import { CheckoutSessionRequestSchema, fieldsFrom, validationDetail } from "@counted/contracts";
import type { Dependencies } from "../composition";
import { requires, workspaceFromPath, publicRoute, type RouteDefinition } from "../http/route";
import { sendProblem } from "../http/respond";

/** Where the browser goes after checkout or the portal. */
const returnPath = (base: string, path: string): string => `${base.replace(/\/+$/, "")}${path}`;

export const billingRoutes = (deps: Dependencies): readonly RouteDefinition[] => [
  {
    method: "get",
    path: "/v1/workspaces/:workspaceId/usage",
    security: requires("billing:read", workspaceFromPath()),
    handler: async (c) => {
      const workspace = WorkspaceId(c.req.param("workspaceId")!);
      const at = deps.clock.now();

      const [subscription, projects] = await Promise.all([
        deps.subscriptions.find(workspace),
        deps.unitOfWork.transact((r) => r.projects.listForWorkspace(workspace)),
      ]);
      const entitlement = Subscription.entitlementOf(subscription ?? Subscription.none(workspace, at));

      // Counted across the workspace's projects, which is where the allowance
      // lives. Asking per project would let anyone stay free by making more.
      const used = await deps.usage.eventsInCurrentPeriod(workspace);
      const decision = Quota.decide(entitlement, { used });

      return c.json({
        events: {
          used: decision.used,
          limit: entitlement.limits.eventsPerMonth,
          // Named, not implied. `overage` is the band where events are still
          // stored but the customer is past their allowance.
          state: decision.kind === "accept" ? "ok" : decision.kind === "overage" ? "overage" : "rejected",
        },
        projects: { used: projects.length, limit: entitlement.limits.projects },
        plan: entitlement.plan,
        inGrace: entitlement.inGrace,
      });
    },
  },
  {
    method: "get",
    path: "/v1/workspaces/:workspaceId/subscription",
    security: requires("billing:read", workspaceFromPath()),
    handler: async (c) => {
      const workspace = WorkspaceId(c.req.param("workspaceId")!);
      const at = deps.clock.now();
      const subscription = (await deps.subscriptions.find(workspace)) ?? Subscription.none(workspace, at);
      const entitlement = Subscription.entitlementOf(subscription);

      return c.json({
        plan: entitlement.plan,
        paymentState: subscription.payment,
        // True when a paid plan is being honoured despite a payment problem.
        // The customer keeps working and the UI can say something.
        inGrace: entitlement.inGrace,
        renewsAt: subscription.renewsAt === null ? null : Instant.toISO(subscription.renewsAt),
        limits: entitlement.limits,
        // Whether a portal session can be opened at all. Not the customer id.
        hasBillingAccount: subscription.customer !== null,
      });
    },
  },
  {
    method: "post",
    path: "/v1/workspaces/:workspaceId/billing/checkout-sessions",
    security: requires("billing:write", workspaceFromPath()),
    handler: async (c) => {
      let raw: unknown = {};
      try {
        raw = await c.req.json();
      } catch {
        // Empty body is fine; the schema's defaults apply.
      }
      const parsed = CheckoutSessionRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const fields = fieldsFrom(parsed.error);
        return sendProblem(c, "request.validation_failed", { detail: validationDetail(fields), fields });
      }

      const workspace = WorkspaceId(c.req.param("workspaceId")!);
      const existing = await deps.subscriptions.find(workspace);

      try {
        const session = await deps.billing.createCheckoutSession({
          workspace,
          plan: "pro",
          cadence: parsed.data.cadence,
          customer: existing?.customer ?? null,
          successUrl: returnPath(deps.config.appUrl, "/settings/billing?checkout=complete"),
          cancelUrl: returnPath(deps.config.appUrl, "/settings/billing"),
        });
        return c.json({ url: session.url }, 201);
      } catch (error) {
        // The provider failed. Say so, retryably — a checkout button that does
        // nothing is worse than one that reports an outage.
        c.get("log").error("billing.checkout_failed", {
          workspaceId: String(workspace),
          error: error instanceof Error ? error.message : "unknown",
        });
        return sendProblem(c, "billing.provider_unavailable");
      }
    },
  },
  {
    method: "post",
    path: "/v1/workspaces/:workspaceId/billing/portal-sessions",
    security: requires("billing:write", workspaceFromPath()),
    handler: async (c) => {
      const workspace = WorkspaceId(c.req.param("workspaceId")!);
      const subscription = await deps.subscriptions.find(workspace);

      if (subscription?.customer == null) {
        // Nothing to manage yet. A 409 with a reason beats a portal URL that
        // 404s at the provider.
        return sendProblem(c, "billing.no_account", {
          detail: "This workspace has never been to checkout, so there is no billing account to manage.",
        });
      }

      try {
        const session = await deps.billing.createPortalSession({
          customer: subscription.customer,
          // A page that renders. v1 pointed this at a route that immediately
          // redirected, so a customer finishing in the portal landed on a
          // redirect chain and often ended up signed out.
          returnUrl: returnPath(deps.config.appUrl, "/settings/billing"),
        });
        return c.json({ url: session.url }, 201);
      } catch (error) {
        c.get("log").error("billing.portal_failed", {
          workspaceId: String(workspace),
          error: error instanceof Error ? error.message : "unknown",
        });
        return sendProblem(c, "billing.provider_unavailable");
      }
    },
  },
  {
    method: "post",
    path: "/v1/webhooks/stripe",
    // Authenticated by signature, not by credential: the caller is Stripe and
    // it has no key of ours. The handler's first act is to verify.
    security: publicRoute(
      "Authenticated by HMAC signature over the raw body with a timestamp window, not by a credential. Verification is the handler's first act.",
    ),
    handler: async (c) => {
      const log = c.get("log");
      const at = deps.clock.now();

      // The raw bytes, not a parsed object: the signature is over the body
      // exactly as sent, and re-serialising JSON changes it.
      const body = await c.req.text();
      const verified = deps.billing.verifyWebhook(body, c.req.header("stripe-signature"), at);

      if (!verified.ok) {
        log.warn("billing.webhook_rejected", { reason: verified.error.reason });
        // 400, not 401: there is no credential to challenge for, and Stripe
        // treats 4xx as "stop retrying", which is right for a bad signature.
        return sendProblem(c, "request.malformed", {
          detail: "The webhook signature did not verify.",
        });
      }

      const { id, type, event, workspace } = verified.value;

      const fresh = await deps.webhooks.claim(id, type, at);
      if (!fresh) {
        // Already handled. Acknowledge so Stripe stops, and do nothing else.
        log.info("billing.webhook_replayed", { eventId: id, type });
        return c.json({ received: true, applied: false, reason: "already_processed" });
      }

      if (event === null) {
        // Not an event we act on. Acknowledged so it is not retried forever,
        // and logged so we can see which types are arriving.
        log.info("billing.webhook_ignored", { eventId: id, type });
        await deps.webhooks.markProcessed(id, at);
        return c.json({ received: true, applied: false, reason: "not_actionable" });
      }

      // Which workspace this concerns. Checkout carries it in metadata; every
      // later event names only the provider's own ids, so it is resolved
      // through them.
      const current = await resolveSubscription(deps, workspace, event, at);
      if (current === null) {
        // Signature valid, event actionable, and we cannot place it. Loud,
        // because this is a paying customer we cannot credit.
        log.error("billing.webhook_unplaceable", { eventId: id, type });
        await deps.webhooks.markProcessed(id, at);
        return c.json({ received: true, applied: false, reason: "unknown_workspace" });
      }

      const transition = applyBillingEvent(current, event, at);
      // Always writes a row. This is the line v1 got wrong.
      await deps.subscriptions.save(transition.subscription);
      await deps.webhooks.markProcessed(id, at);

      log.info("billing.webhook_applied", {
        eventId: id,
        type,
        workspaceId: String(transition.subscription.workspace),
        plan: transition.subscription.plan,
        paymentState: transition.subscription.payment,
        entitlementChanged: transition.entitlementChanged,
        notable: transition.notable,
      });

      return c.json({ received: true, applied: true, entitlementChanged: transition.entitlementChanged });
    },
  },
];

/**
 * Find the subscription an event concerns, or start one.
 *
 * Checkout is the only event that carries our workspace id, and it is also the
 * only one where no row may exist yet — so it starts one. Everything after it
 * is matched on the provider's ids, and failing to match is reported rather
 * than papered over.
 */
const resolveSubscription = async (
  deps: Dependencies,
  workspace: WorkspaceId | null,
  event: { kind: string; subscription?: string; customer?: string },
  at: Instant,
): Promise<Subscription | null> => {
  if (workspace !== null) {
    return (await deps.subscriptions.find(workspace)) ?? Subscription.none(workspace, at);
  }
  if (event.subscription !== undefined) {
    const found = await deps.subscriptions.findBySubscriptionRef(event.subscription);
    if (found !== null) return found;
  }
  if (event.customer !== undefined) {
    const found = await deps.subscriptions.findByCustomer(event.customer);
    if (found !== null) return found;
  }
  return null;
};
