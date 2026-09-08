/**
 * The grant table and the credential-kind ceiling from V3-SPEC §4, as test
 * doubles.
 *
 * `@counted/authorization` is authoritative for the table and
 * `@counted/projects-domain` is authoritative for the ceiling. A ports package
 * may import neither (`ports-declare-only`), so the fakes and the contract
 * suites need their own copy — and a copy that drifts is worse than no copy.
 *
 * Two things keep this honest, and both are needed:
 *
 *   - `role-grants.test.ts` pins these values to the *specification*, written
 *     out a second time, rather than to themselves.
 *   - `apps/api/src/auth/grants.test.ts` asserts, role by role and kind by
 *     kind, that this double equals the real composition. It lives there
 *     because `apps/api` is the only layer allowed to import the real table,
 *     the real ceiling and this file at once. If the two ever diverge, that
 *     test fails and names the difference.
 *
 * Nothing in production should import this. Pass the real composition in as a
 * `CredentialGrants` from the composition root.
 */

import { ALL_PERMISSIONS, type Permission, type Role } from "@counted/kernel";
import type { CredentialGrants, CredentialKind } from "../credential-kind";

/** Everything a member holds. Reads, plus the writes that are cheap to undo. */
const MEMBER: readonly Permission[] = [
  "queries:run",
  "projects:read",
  "dashboards:read",
  "dashboards:write",
  "monitors:read",
  "monitors:write",
  "workspace:read",
];

/** Member, plus projects, credentials and reading the bill. */
const ADMIN: readonly Permission[] = [
  ...MEMBER,
  "events:write",
  "projects:write",
  "credentials:read",
  "credentials:write",
  "billing:read",
];

/** Admin, plus deleting a project, administering the workspace, and paying. */
const OWNER: readonly Permission[] = [
  ...ADMIN,
  "projects:delete",
  "workspace:admin",
  "billing:write",
];

const TABLE: Record<Role, readonly Permission[]> = {
  member: MEMBER,
  admin: ADMIN,
  owner: OWNER,
};

/** Ordered by `ALL_PERMISSIONS`, so two expansions of the same set compare equal. */
export const specRoleGrants = (role: Role): readonly Permission[] => {
  const held = new Set(TABLE[role]);
  return ALL_PERMISSIONS.filter((p) => held.has(p));
};

/**
 * An ingest key carries exactly this, whatever the issuer holds. The key ships
 * in browser bundles where anybody can read it.
 */
const INGEST_CEILING: readonly Permission[] = ["events:write"];

/**
 * The most a service key may ever carry, before the issuer's own holdings are
 * intersected with it. `workspace:admin` and `billing:write` are absent on
 * purpose: a bearer token with a months-long lifetime must not be able to
 * change who owns the workspace or what it pays.
 */
const SERVICE_CEILING: readonly Permission[] = ALL_PERMISSIONS.filter(
  (p) => p !== "workspace:admin" && p !== "billing:write",
);

const CEILING: Record<CredentialKind, readonly Permission[]> = {
  ingest: INGEST_CEILING,
  service: SERVICE_CEILING,
};

/**
 * The double for the whole derivation: role first, then kind. This is the
 * shape a `CredentialStore` is configured with, so a fake that passes the
 * contract suite is exercising the same composition production uses.
 */
export const specCredentialGrants: CredentialGrants = (kind, role) => {
  const held = new Set(specRoleGrants(role));
  return CEILING[kind].filter((p) => held.has(p));
};
