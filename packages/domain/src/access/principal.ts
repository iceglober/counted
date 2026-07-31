/**
 * Who is asking.
 *
 * A principal is what authentication produces and authorization consumes. It
 * is a closed union, so "some other kind of caller" is unrepresentable — and
 * `anonymous` is a member of it rather than `null`, which is what stops an
 * unauthenticated request from being an absent check.
 *
 * Note what is *not* here: no `role` field. A role is a fact about an account
 * inside a workspace, resolved per decision, not carried on the principal. v1
 * baked a role into its session-shaped object and then had to fabricate one
 * (`{userId: "", role: "owner"}`) whenever the caller was an API key.
 */

import type { AccountId, CredentialId, DashboardId, ProjectId, WorkspaceId } from "../shared/ids";
import type { Scope } from "./scope";

export type Principal =
  /** No credential, or one that did not resolve. Denied everything. */
  | { readonly kind: "anonymous" }
  /** A signed-in human at the console. Authority comes from membership. */
  | { readonly kind: "account"; readonly account: AccountId }
  /** A public key in a browser bundle. Bound to one project, one scope. */
  | {
      readonly kind: "ingest";
      readonly credential: CredentialId;
      readonly project: ProjectId;
      readonly scopes: readonly Scope[];
    }
  /**
   * A server-side key. Bound to a workspace, optionally narrowed to some of
   * its projects. `onBehalfOf` is a real account id kept for audit, so an
   * object created by a key has a truthful author.
   */
  | {
      readonly kind: "service";
      readonly credential: CredentialId;
      readonly workspace: WorkspaceId;
      readonly projects: readonly ProjectId[] | "all";
      readonly scopes: readonly Scope[];
      readonly onBehalfOf: AccountId;
    }
  /**
   * A share link. One dashboard, read-only, expiring.
   *
   * `projects` is the set that dashboard's tiles read from — a dashboard may
   * span several — so a share link can run exactly the queries the page it
   * shows needs, and no others.
   */
  | {
      readonly kind: "share";
      readonly credential: CredentialId;
      readonly dashboard: DashboardId;
      readonly projects: readonly ProjectId[];
      readonly scopes: readonly Scope[];
    }
  /** The worker, on the private network. Never reachable from the internet. */
  | { readonly kind: "worker"; readonly scopes: readonly Scope[] };

export const Principal = {
  ANONYMOUS: { kind: "anonymous" } as Principal,

  /**
   * Who to record as the author of something this principal creates.
   *
   * A key acts for the account that issued it. There is no synthetic user.
   */
  actor: (p: Principal): AccountId | null => {
    switch (p.kind) {
      case "account":
        return p.account;
      case "service":
        return p.onBehalfOf;
      default:
        return null;
    }
  },

  /** For logs and problem details. Contains no secret and no digest. */
  describe: (p: Principal): string => {
    switch (p.kind) {
      case "anonymous":
        return "anonymous";
      case "account":
        return `account:${p.account}`;
      case "ingest":
        return `ingest:${p.credential}`;
      case "service":
        return `service:${p.credential}`;
      case "share":
        return `share:${p.credential}`;
      case "worker":
        return "worker";
    }
  },
} as const;
