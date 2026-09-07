/**
 * Q1 — "does this role have this permission".
 *
 * The single grant table, written once as data and expanded through
 * `accesscontrol`. This module is the only place in the repo allowed to import
 * that library, and `ac.can(...)` must not escape it: replacing the library
 * has to stay a one-file change, and a route handler that reaches for it has
 * started a second policy.
 *
 * The translation lives here too. `accesscontrol` speaks action-on-resource
 * (`ac.can("admin").do("write", "projects")`); Counted speaks a flat
 * `resource:action` string, because that is what travels on a credential, in
 * an OpenAPI `security` block, and in a denial. `splitPermission` is the seam,
 * and it is one line.
 *
 * The library's contribution is inheritance: `admin` extends `member`, `owner`
 * extends `admin`, so each role is written as what it *adds*. Get that from a
 * hand-rolled spread and the three lists drift the first time somebody edits
 * the middle one.
 */

import {
  ALL_PERMISSIONS,
  isPermission,
  Role,
  ROLES,
  splitPermission,
  type Permission,
} from "@counted/kernel";
import { AccessControl } from "accesscontrol";

/**
 * What each role ADDS to the one below it. Fifteen permissions across three
 * roles; the full holdings are computed, never written twice.
 *
 * A member reads, and writes the things that are cheap to undo — dashboards
 * and monitors. An admin adds projects, credentials, and reading billing. An
 * owner adds workspace administration, paying, and destroying a project.
 *
 * `projects:delete` is the owner's and not the admin's for the same reason
 * `workspace:admin` is: it is not undoable. An admin may rename, archive and
 * restore a project all day; deleting it takes the events with it.
 *
 * `events:write` is an admin permission and not a member one on purpose: it is
 * what an ingest credential carries, so granting it to members would let any
 * member mint a key that writes into the workspace's data.
 */
const ADDS: Readonly<Record<Role, readonly Permission[]>> = {
  member: [
    "queries:run",
    "projects:read",
    "dashboards:read",
    "dashboards:write",
    "monitors:read",
    "monitors:write",
    "workspace:read",
  ],
  admin: ["events:write", "projects:write", "credentials:read", "credentials:write", "billing:read"],
  owner: ["projects:delete", "workspace:admin", "billing:write"],
};

/** Lowest authority first, because `extend` needs the base role to exist. */
const INHERITANCE: readonly Role[] = ["member", "admin", "owner"];

const buildGrants = (): AccessControl => {
  const ac = new AccessControl();

  let below: Role | null = null;
  for (const role of INHERITANCE) {
    const access = ac.grant(role);
    if (below !== null) access.extend(below);
    for (const permission of ADDS[role]) {
      const { resource, action } = splitPermission(permission);
      access.do(action, resource);
    }
    below = role;
  }

  // Nothing may add a grant after load. A mutable policy object is a policy
  // that a later import can widen without anybody reviewing the widening.
  return ac.lock();
};

/**
 * Ask the library once per role×permission at load, and keep the answer.
 *
 * Two reasons, and neither is speed. A memo makes `permits` total — an unknown
 * role reaches a `Set` lookup rather than `ac.can("nobody")`, which throws
 * "Role not found", and an authorization function that throws is an
 * authorization function that a `catch` somewhere can turn into an allow.
 * And it makes the expansion a value a test can compare against the table in
 * V3-SPEC §4, which is how we know the inheritance did what we meant.
 */
const HOLDINGS: Readonly<Record<Role, ReadonlySet<Permission>>> = (() => {
  const ac = buildGrants();
  const held = {} as Record<Role, ReadonlySet<Permission>>;
  for (const role of ROLES) {
    const granted = ALL_PERMISSIONS.filter((permission) => {
      const { resource, action } = splitPermission(permission);
      return ac.can(role).do(action, resource).granted;
    });
    held[role] = new Set(granted);
  }
  return held;
})();

/**
 * Q1, and the only answer to it. Fail-closed on anything it does not
 * recognise: a permission string that is not in the vocabulary is denied
 * rather than parsed, so a typo in a route's declaration locks the route
 * instead of opening it.
 */
export const permits = (role: Role, permission: Permission): boolean => {
  if (!Role.is(role) || !isPermission(permission)) return false;
  return HOLDINGS[role].has(permission);
};

/**
 * Everything a role holds, in the vocabulary's canonical order.
 *
 * This is also the ceiling for anything that role issues — see
 * `grantable` — which is why it is a set and not a list of strings assembled
 * at the call site.
 */
export const permissionsForRole = (role: Role): readonly Permission[] =>
  Role.is(role) ? ALL_PERMISSIONS.filter((permission) => HOLDINGS[role].has(permission)) : [];

/** Which roles hold a given permission. For explaining a denial, not deciding one. */
export const rolesHolding = (permission: Permission): readonly Role[] =>
  ROLES.filter((role) => permits(role, permission));
