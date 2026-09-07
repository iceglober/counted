/**
 * Domain events emitted by the Workspace aggregate.
 *
 * Facts, past tense. They leave the transaction that produced them through the
 * outbox and reach the worker, which is what turns `PaymentStateChanged` into
 * an email and `OverProjectLimit` into a downgrade prompt — without the
 * aggregate ever deciding to delete a customer's data.
 *
 * **No membership events.** v2 had `MemberAdmitted`, `RoleChanged` and
 * `MemberRemoved` here. Under v3 better-auth owns membership, so this context
 * cannot honestly claim a member was admitted: it did not do it and does not
 * know. Emitting them anyway would be a second, lagging record of a table
 * somebody else writes.
 *
 * `OverSeatLimit` survives that removal because it is an entitlement fact —
 * "this plan seats fewer people than are here" — and only tenancy knows the
 * plan. The seat count reaches the aggregate as a value, read from
 * `MembershipDirectory` by the caller.
 */

import type { AccountId, Instant, ProjectId, WorkspaceId } from "@counted/kernel";
import type { PaymentState } from "./entitlement";
import type { WorkspaceLimits } from "./limits";
import type { PlanId } from "./plan";

export type WorkspaceEvent =
  | {
      readonly kind: "WorkspaceOpened";
      readonly workspace: WorkspaceId;
      readonly founder: AccountId;
      readonly at: Instant;
    }
  | {
      readonly kind: "WorkspaceRenamed";
      readonly workspace: WorkspaceId;
      readonly name: string;
      readonly at: Instant;
    }
  | {
      readonly kind: "PlanChanged";
      readonly workspace: WorkspaceId;
      readonly from: PlanId;
      readonly to: PlanId;
      readonly at: Instant;
    }
  | {
      readonly kind: "PaymentStateChanged";
      readonly workspace: WorkspaceId;
      readonly from: PaymentState;
      readonly to: PaymentState;
      readonly at: Instant;
    }
  | {
      readonly kind: "ProjectProvisioned";
      readonly workspace: WorkspaceId;
      readonly project: ProjectId;
      readonly name: string;
      readonly at: Instant;
    }
  | {
      readonly kind: "ProjectArchived";
      readonly workspace: WorkspaceId;
      readonly project: ProjectId;
      readonly at: Instant;
    }
  | {
      readonly kind: "ProjectRestored";
      readonly workspace: WorkspaceId;
      readonly project: ProjectId;
      readonly at: Instant;
    }
  | {
      /** The project is gone, not archived. The slot it held is released. */
      readonly kind: "ProjectDeregistered";
      readonly workspace: WorkspaceId;
      readonly project: ProjectId;
      readonly at: Instant;
    }
  | {
      readonly kind: "LimitsChanged";
      readonly workspace: WorkspaceId;
      readonly limits: WorkspaceLimits;
      readonly at: Instant;
    }
  | {
      /** Emitted on a downgrade, never acted on here. A policy decides what happens. */
      readonly kind: "OverProjectLimit";
      readonly workspace: WorkspaceId;
      readonly active: number;
      readonly limit: number;
      readonly at: Instant;
    }
  | {
      readonly kind: "OverSeatLimit";
      readonly workspace: WorkspaceId;
      readonly seats: number;
      readonly limit: number;
      readonly at: Instant;
    };

/** The envelope `type` string for a tenancy event: `"tenancy.<Kind>"`. */
export const tenancyEventType = (event: WorkspaceEvent): string => `tenancy.${event.kind}`;
