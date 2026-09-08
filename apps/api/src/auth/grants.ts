/**
 * Where the grant table and the credential-kind ceiling are joined, once.
 *
 * Two packages own half of the rule each, and neither may import the other:
 *
 *   `@counted/authorization`   role → permissions. The only package that may
 *                              touch `accesscontrol`.
 *   `@counted/projects-domain` the delegation ceiling: what a credential of
 *                              this kind may carry, as a pure function of the
 *                              permissions its issuer holds. A domain package
 *                              may not import `@counted/authorization`, which
 *                              is exactly why it takes the holdings as a value
 *                              rather than a role.
 *
 * `apps/api` is the composition root and the only layer allowed to hold both,
 * so the composition lives here — one expression, wired into the identity
 * adapter at startup and into every fake through
 * `@counted/identity-ports/testing`.
 *
 * There were three statements of this rule before this file existed:
 * `grantableTo` in the projects domain (the strict one, and the one in
 * effect), `grantable` in `@counted/authorization` (called by nothing), and
 * `grantablePermissions` in `@counted/identity-ports` — which had no ceiling
 * at all, so the store handed an owner a service key carrying
 * `workspace:admin` and `billing:write`, and the projects app then revoked it
 * on the way out. An owner could not issue a service key. That is what three
 * copies of one rule costs.
 */

import { permissionsForRole } from "@counted/authorization";
import type { CredentialGrants } from "@counted/identity-ports";
import { grantableTo } from "@counted/projects-domain";

/**
 * The permission set a credential of this kind, issued by this role, carries.
 *
 * An empty result is not an error here: it is `NothingGrantable`, which the
 * store turns into a refusal. `grantableTo` refuses with `PermissionsRequired`
 * for the same case, and the two spellings mean the same thing — the issuer's
 * role grants nothing this kind of key may carry.
 */
export const credentialGrants: CredentialGrants = (kind, role) => {
  const grantable = grantableTo(kind, permissionsForRole(role));
  return grantable.ok ? grantable.value : [];
};
