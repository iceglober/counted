/**
 * Membership — an account's standing in a workspace.
 *
 * This replaces both dead tenancy models at once: the `organization`/`member`/
 * `invitation` tables that no authorization code ever read, and
 * `project_members`, which was alive but only ever stored `role='owner'` and
 * had no invite flow. One concept, real roles.
 */

import type { AccountId } from "../shared/ids";
import type { Instant } from "../shared/instant";

/**
 * Roles are ordered by authority. `rank` exists so comparisons read as
 * comparisons rather than as a chain of string equality checks.
 */
export type Role = "owner" | "admin" | "member";

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

export const Role = {
  rank: (r: Role): number => RANK[r],
  atLeast: (actual: Role, required: Role): boolean => RANK[actual] >= RANK[required],

  /** Billing and workspace deletion are owner-only. */
  canManageBilling: (r: Role): boolean => r === "owner",
  /** Admitting, removing, and re-roling members. */
  canManageMembers: (r: Role): boolean => RANK[r] >= RANK.admin,
  /** Creating and archiving projects, rotating credentials. */
  canManageProjects: (r: Role): boolean => RANK[r] >= RANK.admin,
} as const;

export type Membership = {
  readonly account: AccountId;
  readonly role: Role;
  readonly since: Instant;
};

export const Membership = {
  create: (account: AccountId, role: Role, since: Instant): Membership => ({
    account,
    role,
    since,
  }),
  withRole: (m: Membership, role: Role): Membership => ({ ...m, role }),
} as const;
