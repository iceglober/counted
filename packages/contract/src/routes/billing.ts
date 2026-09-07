/**
 * Billing. Three routes, and the webhook is not one of them.
 *
 * `POST /v1/webhooks/stripe` stays hand-written in `apps/api` because signature
 * verification needs the raw request body, and any framework that has already
 * parsed the JSON has destroyed the thing being verified. oRPC's Hono adapter
 * returns a `matched` flag and lets unmatched requests fall through, which is
 * what makes leaving it out of the contract safe rather than merely convenient.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";
import { route } from "../route";
import { BILLING_ERRORS } from "../errors";
import { WorkspaceIdSchema } from "../primitives";
import {
  HostedSessionSchema,
  PlanIdSchema,
  PlanSchema,
  SubscriptionSchema,
  BillingPriceSchema,
  BillingDetailsSchema,
} from "../schemas/tenancy";

const TAGS = ["billing"] as const;

export const plans = oc
  .meta(
    route({
      id: "billing.plans",
      method: "GET",
      path: "/v1/workspaces/{workspaceId}/billing/plans",
      summary: "List the plans this workspace can move to",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "billing:read",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(BILLING_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema }))
  .output(z.object({ items: z.array(PlanSchema), current: PlanIdSchema,
    pricing: z.enum(["available", "unavailable", "unconfigured"]), prices: z.array(BillingPriceSchema),
  }));

export const subscription = oc
  .meta(
    route({
      id: "billing.subscription",
      method: "GET",
      path: "/v1/workspaces/{workspaceId}/subscription",
      summary: "Read the workspace's subscription",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "billing:read",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(BILLING_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema }))
  .output(z.object({ subscription: SubscriptionSchema,
    billingAvailable: z.boolean(), details: BillingDetailsSchema.nullable(),
    detailsUnavailable: z.boolean(),
  }));

export const checkout = oc
  .meta(
    route({
      id: "billing.checkout",
      method: "POST",
      path: "/v1/workspaces/{workspaceId}/billing/checkout",
      summary: "Open a hosted checkout session",
      description:
        "Returns a URL to send the customer to. Counted never sees a card number, which is why there is no route that takes one.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "billing:write",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(BILLING_ERRORS)
  .input(
    z.object({
      workspaceId: WorkspaceIdSchema,
      plan: PlanIdSchema,
      cadence: z.enum(["monthly", "annual"]),
      successUrl: z.url(),
      cancelUrl: z.url(),
    }),
  )
  .output(z.object({ session: HostedSessionSchema }));

export const portal = oc
  .meta(
    route({
      id: "billing.portal",
      method: "POST",
      path: "/v1/workspaces/{workspaceId}/billing/portal",
      summary: "Open the provider's billing portal",
      description:
        "Fails with `NoSubscription` when the workspace has never paid — there is no portal to open for a customer that does not exist yet.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "billing:write",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(BILLING_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema, returnUrl: z.url() }))
  .output(z.object({ session: HostedSessionSchema }));
