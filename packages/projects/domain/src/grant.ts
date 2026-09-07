/**
 * Q3 — may this principal grant what it is granting?
 *
 * v2 had no answer. `project.ts:300` copied the requested scopes straight onto
 * the new credential and validated only that there was at least one. Issuing
 * required `credentials:write`, which **admin** holds, while `workspace:admin`
 * and `billing:write` are **owner**-only — so an admin minted a service key
 * carrying owner permissions and acted through it. That is privilege
 * escalation, and it was reachable.
 *
 * v3 closes it twice over, and the redundancy is deliberate:
 *
 *   *By construction* — `@better-auth/api-key` treats `permissions` as a
 *   server-only property, so `IssueRequest` has no field for a client to fill.
 *   The request body the hole depended on does not exist.
 *
 *   *By rule* — this file. Because "the vendor rejects it" is a property of a
 *   vendor we could replace, and the rule that a key may never out-rank its
 *   issuer should survive that replacement.
 *
 * The issuer's permissions arrive as a **value**. This package cannot ask
 * `@counted/authorization` what a role holds — a domain imports the kernel and
 * itself — and it should not want to: the grant table is one policy, expanded
 * once, in the layer that owns it, and passed down.
 */

import { err, ok, type Permission, type Result } from "@counted/kernel";
import type { CredentialKind } from "./credential";
import type { ProjectError } from "./errors";

/**
 * An ingest key carries exactly this, whatever was requested, forever.
 *
 * These keys are **public**. They ship in browser bundles and mobile binaries
 * where anybody can read them, so the blast radius of a leaked one has to be
 * "somebody can send you events you did not send". Any second permission on
 * this list makes that sentence longer.
 */
export const INGEST_PERMISSIONS: readonly Permission[] = ["events:write"];

/**
 * What a service key may ever carry — the issuer's own set is then intersected
 * with this.
 *
 * `workspace:admin` and `billing:write` are excluded on purpose. A service key
 * is a bearer token with no session, no second factor, and a lifetime measured
 * in months; the two things it must not be able to do are change who owns the
 * workspace and change what it pays. Both remain reachable — by a human, in a
 * session, which is the point.
 *
 * `projects:delete` IS delegable, and the asymmetry is deliberate. Deleting a
 * project is destructive but it is ordinary product surface — an agent that
 * provisioned a project is the thing most likely to tear it down — and the
 * permission is owner-only in the grant table, so a key an admin issued still
 * cannot delete anything. That is the rule the owner-role floor was reaching
 * for, expressed as a permission the one authorization function can check.
 *
 * This is a product decision, not a mechanical one. It lives in one const so
 * reversing it is one line and one test.
 */
export const SERVICE_DELEGABLE_PERMISSIONS: readonly Permission[] = [
  "events:write",
  "queries:run",
  "projects:read",
  "projects:write",
  "projects:delete",
  "dashboards:read",
  "dashboards:write",
  "monitors:read",
  "monitors:write",
  "credentials:read",
  "credentials:write",
  "workspace:read",
  "billing:read",
];

/**
 * The rule, stated on its own so it can be tested on its own: no credential may
 * carry a permission its issuer does not hold.
 *
 * The error names the *excess*, not the whole request. "You asked for
 * billing:write and you do not have it" is actionable; "one of these eleven is
 * wrong" is not.
 */
export const withinGrant = (
  requested: readonly Permission[],
  held: readonly Permission[],
): Result<readonly Permission[], ProjectError> => {
  if (requested.length === 0) return err({ kind: "PermissionsRequired" });
  const excess = requested.filter((p) => !held.includes(p));
  if (excess.length > 0) {
    return err({ kind: "PermissionEscalation", requested: excess, held: [...held] });
  }
  return ok([...requested]);
};

/**
 * The permission set a new credential gets. **Nothing else may author one.**
 *
 * That invariant is the whole reason better-auth's own `createAccessControl` is
 * left switched off: `accesscontrol` is the single grant table, a key's
 * `Record<string, string[]>` is a representation derived from it here, and
 * verification is then a containment check rather than a second decision. The
 * moment somebody types a permission set onto a key by hand there are two
 * policies and no rule about which wins.
 *
 * `held` is the issuer's expanded permission set — from their role, and from
 * their role only.
 */
export const grantableTo = (
  kind: CredentialKind,
  held: readonly Permission[],
): Result<readonly Permission[], ProjectError> => {
  if (kind === "ingest") {
    // Still checked against the issuer: an account that may not write events
    // may not mint something that writes events on its behalf.
    return withinGrant(INGEST_PERMISSIONS, held);
  }
  const delegable = SERVICE_DELEGABLE_PERMISSIONS.filter((p) => held.includes(p));
  // Empty means the issuer's role grants nothing a service key may carry —
  // `NothingGrantable` in identity's vocabulary, `PermissionsRequired` in ours.
  return withinGrant(delegable, held);
};
