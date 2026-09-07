/**
 * What a workspace has used, against what it is entitled to.
 *
 * One function assembles the whole readout, and it takes its project count from
 * `Workspace.projectCount` — the same call the cap check makes. That is the
 * point of the module. v2 answered "how many projects" in two places with two
 * different rules, so the usage bar and the create button could disagree about
 * whether a customer was full; here they cannot, because there is one number
 * and one caller of the rule that produces it.
 *
 * Events and seats arrive as measured values rather than being read here: the
 * event count comes from the analytics store and the seat count from
 * better-auth's member table, and neither is something a pure function may go
 * and fetch. What this function owns is the *comparison* — which limit applies,
 * and what the result is called.
 */

import type { Entitlement } from "./entitlement";
import type { PlanId } from "./plan";
import { Quota, type QuotaState } from "./quota";
import type { Workspace } from "./workspace";

/** What the caller has measured elsewhere and is asking us to judge. */
export type MeasuredUsage = {
  /** Events recorded in the current billing period, across the whole workspace. */
  readonly events: number;
  /** People in the workspace right now, from `MembershipDirectory`. */
  readonly seats: number;
};

export type WorkspaceUsage = {
  readonly plan: PlanId;
  readonly inGrace: boolean;
  readonly events: {
    readonly used: number;
    readonly limit: number | null;
    /** `ok` / `overage` / `rejected` — the vocabulary the wire already uses. */
    readonly state: QuotaState;
  };
  readonly projects: { readonly used: number; readonly limit: number | null };
  readonly seats: { readonly used: number; readonly limit: number | null };
};

export const workspaceUsage = (workspace: Workspace, measured: MeasuredUsage): WorkspaceUsage => {
  const entitlement: Entitlement = workspace.entitlement;
  const decision = Quota.decide(entitlement, { used: measured.events });

  return {
    plan: entitlement.plan,
    inGrace: entitlement.inGrace,
    events: { used: decision.used, limit: entitlement.limits.eventsPerMonth, state: decision.kind },
    projects: { used: workspace.projectCount, limit: workspace.limits.maxProjects },
    seats: { used: measured.seats, limit: workspace.limits.maxSeats },
  };
};
