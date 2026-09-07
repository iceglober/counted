/**
 * Who is asking.
 *
 * A closed union, so "some other kind of caller" is unrepresentable, and
 * `anonymous` is a member of it rather than `null` — which is what stops an
 * unauthenticated request from being an *absent* check rather than a failed
 * one.
 *
 * Two things are deliberately not here.
 *
 * There is no bare `role` field. v1 baked a role into a session-shaped object
 * and then had to fabricate one (`{ userId: "", role: "owner" }`) whenever the
 * caller was an API key — a synthetic owner with an empty id that got written
 * into `created_by` columns. Here a human's authority is a `WorkspaceRole`:
 * the role AND the workspace it was read in, together. Carrying them apart is
 * how a role resolved in workspace A ends up deciding a question about
 * workspace B.
 *
 * There is no `worker` kind. The worker composes use cases in process behind
 * the private network; it does not authenticate and it does not hold a
 * principal. If it ever serves a request it needs its own kind here, with its
 * own permissions — not an account principal wearing a made-up account id.
 */

import type { AccountId, CredentialId, DashboardId, Permission, ProjectId, Role, WorkspaceId } from "@counted/kernel";

/**
 * A human's standing in one workspace: what they may do, and where they were
 * found to be able to do it. Resolved per request by whoever builds the
 * principal, from `MembershipDirectory.roleOf`.
 */
export type WorkspaceRole = {
  readonly workspace: WorkspaceId;
  readonly role: Role;
};

export type Principal =
  /**
   * No credential, or one that did not resolve. Denied everything.
   *
   * Unknown, revoked and expired credentials all collapse to this before any
   * decision is made — the caller gets one answer with no detail, so a timing
   * or message difference cannot tell an attacker which of their guesses
   * exists.
   */
  | { readonly kind: "anonymous" }
  /**
   * A signed-in human at the console. `standing` is `null` when they are
   * authenticated but not a member of the workspace the request touches: a
   * different denial from "not signed in", and a different one again from
   * "member, but the role is too low".
   */
  | {
      readonly kind: "account";
      readonly account: AccountId;
      readonly standing: WorkspaceRole | null;
      /** Delegated OAuth consent narrows the current role; absent for a console session. */
      readonly permissionCeiling?: readonly Permission[];
    }
  /**
   * A server-side key. Bound to a workspace, optionally narrowed to some of
   * its projects. `onBehalfOf` is a real account id kept for audit, so an
   * object created through a key has a truthful author.
   *
   * `permissions` is what the key carries, computed at issuance from the
   * issuer's role (see `grantable`) and never named by the client.
   */
  | {
      readonly kind: "service";
      readonly credential: CredentialId;
      readonly workspace: WorkspaceId;
      readonly projects: readonly ProjectId[] | "all";
      readonly permissions: readonly Permission[];
      readonly onBehalfOf: AccountId;
    }
  /**
   * A public key in a browser bundle. Bound to exactly one project.
   *
   * `workspace` is nullable because an unclaimed project has none: it exists,
   * it has an id, and its ingest key works — that is the whole no-signup
   * path. Requiring a workspace here is what made v1's `/v1/provision` key
   * unable to send a single event.
   */
  | {
      readonly kind: "ingest";
      readonly credential: CredentialId;
      readonly project: ProjectId;
      readonly workspace: WorkspaceId | null;
      readonly permissions: readonly Permission[];
    }
  /**
   * A share link: one dashboard, read-only, expiring.
   *
   * `projects` is the set that dashboard's tiles read from — a dashboard may
   * span several — so the link can run exactly the queries the page it shows
   * needs and no others. It comes from `DashboardRepository.projectsReadBy`,
   * which exists for this.
   */
  | {
      readonly kind: "share";
      readonly credential: CredentialId;
      readonly dashboard: DashboardId;
      readonly projects: readonly ProjectId[];
      readonly permissions: readonly Permission[];
    };

export type PrincipalKind = Principal["kind"];

export const PRINCIPAL_KINDS: readonly PrincipalKind[] = [
  "anonymous",
  "account",
  "service",
  "ingest",
  "share",
];

export const Principal = {
  ANONYMOUS: { kind: "anonymous" } as const satisfies Principal,

  /**
   * Who to record as the author of what this principal creates.
   *
   * A key acts for the account that issued it. There is no synthetic user, and
   * an ingest or share credential authors nothing.
   */
  actor: (p: Principal): AccountId | null => {
    switch (p.kind) {
      case "account":
        return p.account;
      case "service":
        return p.onBehalfOf;
      case "anonymous":
      case "ingest":
      case "share":
        return null;
    }
  },

  /** The credential this principal presented, if it presented one. */
  credential: (p: Principal): CredentialId | null => {
    switch (p.kind) {
      case "service":
      case "ingest":
      case "share":
        return p.credential;
      case "account":
      case "anonymous":
        return null;
    }
  },

  /** For audit lines and problem details. Contains no secret and no digest. */
  describe: (p: Principal): string => {
    switch (p.kind) {
      case "anonymous":
        return "anonymous";
      case "account":
        return `account:${p.account}`;
      case "service":
        return `service:${p.credential}`;
      case "ingest":
        return `ingest:${p.credential}`;
      case "share":
        return `share:${p.credential}`;
    }
  },
} as const;
