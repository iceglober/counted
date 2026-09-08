/**
 * Workspace, plan, usage and subscription shapes.
 *
 * Two things are deliberately absent.
 *
 * A workspace has no stored `limits` field. Limits are derived from `plan` and
 * `payment` on every read, because v2 rehydrated a workspace with
 * `WorkspaceLimits.UNLIMITED` hardcoded — the entitlement was resolved
 * elsewhere, and a loaded workspace enforced no cap at all.
 *
 * A subscription carries no provider identifiers. The Stripe customer and
 * subscription ids are of no use to a client and of some use to anyone who
 * should not have them; `hasBillingAccount` is the only fact the console needs,
 * and it answers the only question it asks — whether to show "manage billing".
 */

import * as z from "zod";
import { InstantSchema, RoleSchema, WorkspaceIdSchema, PermissionSchema } from "../primitives";

export const PlanIdSchema = z.enum(["free", "pro"]);
export const PaymentStateSchema = z.enum(["none", "active", "past_due", "canceled"]);

/** `null` means unlimited. Zero would mean "none allowed", which is different. */
export const PlanLimitsSchema = z
  .object({
    eventsPerMonth: z.int().nullable(),
    projects: z.int().nullable(),
    seats: z.int().nullable(),
    retentionDays: z.int().nullable(),
  })
  .meta({ id: "PlanLimits", description: "What a plan allows. Null means unlimited." });

export const PlanSchema = z
  .object({ id: PlanIdSchema, name: z.string(), limits: PlanLimitsSchema })
  .meta({ id: "Plan", description: "A published plan." });

export const WorkspaceSchema = z
  .object({
    id: WorkspaceIdSchema,
    name: z.string(),
    plan: PlanIdSchema,
    payment: PaymentStateSchema,
    /**
     * Archived projects do not count. One predicate answers this question, the
     * cap check and the downgrade warning — v2 counted differently in each
     * place and a workspace could sit permanently one project over its limit.
     */
    projectCount: z.int(),
    limits: PlanLimitsSchema,
    inGrace: z.boolean().describe("Payment has failed but the plan's limits still apply."),
  })
  .meta({ id: "Workspace", description: "A workspace and what its plan allows." });

export const WorkspaceSummarySchema = z
  .object({ id: WorkspaceIdSchema, name: z.string(), role: RoleSchema, permissions: z.array(PermissionSchema) })
  .meta({ id: "WorkspaceSummary", description: "A workspace the caller reaches, and how." });

/**
 * `overage` and `rejected` are distinct on purpose: one is "you are over and we
 * are still accepting", the other is "we have stopped". Collapsing them is how
 * a customer discovers a hard stop from a missing chart.
 */
export const QuotaStateSchema = z.enum(["ok", "overage", "rejected"]);

export const UsageSchema = z
  .object({
    plan: PlanIdSchema,
    inGrace: z.boolean(),
    period: z.object({ from: InstantSchema, resetsAt: InstantSchema, measuredAt: InstantSchema }).describe("Calendar month in UTC; project and seat counts do not reset."),
    events: z.object({
      used: z.int(),
      limit: z.int().nullable(),
      state: QuotaStateSchema,
    }),
    projects: z.object({ used: z.int(), limit: z.int().nullable() }),
    seats: z.object({ used: z.int(), limit: z.int().nullable() }),
  })
  .meta({ id: "Usage", description: "This period's consumption against the plan." });

export const SubscriptionSchema = z
  .object({
    workspace: WorkspaceIdSchema,
    plan: PlanIdSchema,
    payment: PaymentStateSchema,
    renewsAt: InstantSchema.nullable(),
    updatedAt: InstantSchema,
    hasBillingAccount: z
      .boolean()
      .describe("Whether a billing portal session can be opened for this workspace."),
  })
  .meta({ id: "Subscription", description: "What the workspace is paying for." });

/** Where the provider sends the caller next. Short-lived and single-use. */
export const HostedSessionSchema = z
  .object({ url: z.url(), expiresAt: InstantSchema.nullable() })
  .meta({ id: "HostedSession", description: "A hosted checkout or billing-portal URL." });

export const BillingPriceSchema = z.object({
  plan: PlanIdSchema,
  cadence: z.enum(["monthly", "annual"]),
  amount: z.int().nonnegative().describe("Base price in the provider's currency minor unit; the hosted checkout shows the final total."),
  currency: z.string(),
});

export const BillingDetailsSchema = z.object({
  cadence: z.enum(["monthly", "annual"]).nullable(),
  price: z.object({ amount: z.int().nonnegative(), currency: z.string() }).nullable(),
  cancelAtPeriodEnd: z.boolean(),
  periodEndsAt: InstantSchema.nullable(),
});
