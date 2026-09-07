/**
 * Reading what a workspace is entitled to, and what it has used.
 *
 * Both answers cross a boundary the domain may not: the seat count belongs to
 * better-auth's member table and the event count to the analytics store. Those
 * are read here and handed to the domain as values, which is what keeps
 * `Workspace` a pure function of its inputs — and what stops the seat count
 * being cached on the aggregate where it could go stale between a member
 * joining and a downgrade arriving.
 *
 * The event count is a parameter rather than another port. Tenancy would have
 * to name an analytics port to fetch it, and the caller — a usage endpoint that
 * has just measured it, or a worker that has it in hand — always already knows.
 */

import { err, ok, type Result, type WorkspaceId } from "@counted/kernel";
import type { MembershipDirectory } from "@counted/identity-ports";
import {
  workspaceUsage,
  type SeatAllowance,
  type WorkspaceError,
  type WorkspaceUsage,
} from "@counted/tenancy-domain";
import type { WorkspaceRepository } from "./ports";

export type EntitlementDeps = {
  readonly workspaces: WorkspaceRepository;
  readonly memberships: MembershipDirectory;
};

/**
 * May one more person be seated in this workspace?
 *
 * Asked before better-auth is told to add a member, because better-auth knows
 * nothing about plans and would happily seat the eleventh person on a plan that
 * allows ten. No plan caps seats today — see the comment in the catalog — so
 * this currently always allows; it exists as the single place the answer comes
 * from, so the day a cap is published there is one call site to change and not
 * an invite path and an accept path that disagree.
 */
export const checkSeatAllowance = async (
  deps: EntitlementDeps,
  workspace: WorkspaceId,
): Promise<Result<SeatAllowance, WorkspaceError>> => {
  const found = await deps.workspaces.find(workspace);
  if (found === null) return err({ kind: "NoSuchWorkspace", workspace });

  const seats = (await deps.memberships.membersOf(workspace)).length;
  return found.mayAdmitSeat({ seats });
};

export type UsageQuery = {
  readonly workspace: WorkspaceId;
  /** Events recorded in the current billing period, measured by the caller. */
  readonly eventsUsed: number;
};

/**
 * The usage readout: plan, events, projects, seats.
 *
 * Its project count is `Workspace.projectCount` — the same call the create path
 * makes. v2 read that number from SQL with no state filter here and from the
 * aggregate's active-only filter there, so the usage bar could say a customer
 * was over their cap while the create button still worked.
 */
export const readWorkspaceUsage = async (
  deps: EntitlementDeps,
  query: UsageQuery,
): Promise<Result<WorkspaceUsage, WorkspaceError>> => {
  const found = await deps.workspaces.find(query.workspace);
  if (found === null) return err({ kind: "NoSuchWorkspace", workspace: query.workspace });

  const seats = (await deps.memberships.membersOf(query.workspace)).length;
  return ok(workspaceUsage(found, { events: query.eventsUsed, seats }));
};
