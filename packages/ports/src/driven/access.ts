/**
 * Resolving the facts an authorization decision needs.
 *
 * The decision itself is pure and lives in the domain. This port is only the
 * lookups: turn a presented secret into a principal, and answer the two
 * questions `requirements()` can ask for.
 *
 * Splitting it this way is what keeps every authorization rule testable with
 * no database, while leaving exactly one place where a wrong query could make
 * a right rule give a wrong answer.
 */

import type { AccountId, Instant, Placement, Principal, Resource, Role, WorkspaceId } from "@counted/domain";

/** What arrived on the request. A digest, never a secret — the caller hashes. */
export type PresentedCredential = {
  /** SHA-256 of the presented secret. */
  readonly digest: string;
  /** The claimed kind, read from the secret's prefix. A hint for routing the
   *  lookup, never trusted as authority. */
  readonly claimedKind: "ingest" | "service" | "share" | null;
};

export interface AccessResolver {
  /**
   * Who this secret belongs to, or `anonymous`.
   *
   * Returns `anonymous` rather than throwing for an unknown, revoked or
   * expired credential: an unusable credential and no credential are the same
   * amount of authority, and treating them differently is how a timing or
   * message difference tells an attacker which of their guesses exists.
   */
  principalFor(presented: PresentedCredential, at: Instant): Promise<Principal>;

  /** Where a resource sits in the tenancy tree; `null` if it does not exist. */
  placementOf(resource: Resource): Promise<Placement | null>;

  /** An account's role in a workspace; `null` if not a member. */
  roleOf(account: AccountId, workspace: WorkspaceId): Promise<Role | null>;
}
