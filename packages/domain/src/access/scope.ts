/**
 * Scopes — the vocabulary of "may do".
 *
 * Flat `resource:action` strings, coarse on purpose. A scope is the *only*
 * currency of authorization: a role expands into scopes, a credential carries
 * scopes, and the decision function compares scopes. Nothing anywhere asks
 * "is this user an owner?" directly.
 *
 * v1 asked that question in four different ways: `role !== "owner"` inline in
 * route handlers, a duplicated `ownedDashboard` helper pasted verbatim in two
 * files, a `session.user.id === row.userId` comparison that treated a NULL
 * owner as "everyone", and an `sk_` path that synthesised
 * `{userId: "", role: "owner"}` — a fabricated owner with an empty user id
 * that then got written into `created_by` columns.
 */

import type { Role } from "../workspace/membership";

export type Scope =
  | "events:write"
  | "events:read"
  | "queries:run"
  | "projects:read"
  | "projects:write"
  | "projects:delete"
  | "dashboards:read"
  | "dashboards:write"
  | "monitors:read"
  | "monitors:write"
  | "credentials:read"
  | "credentials:write"
  | "workspace:read"
  | "workspace:admin"
  | "billing:read"
  | "billing:write";

export const ALL_SCOPES: readonly Scope[] = [
  "events:write",
  "events:read",
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
  "workspace:admin",
  "billing:read",
  "billing:write",
];

/**
 * Ingest credentials are public — they ship in browser bundles and mobile
 * apps, where anyone can read them. They may therefore do exactly one thing.
 */
export const INGEST_SCOPES: readonly Scope[] = ["events:write"];

/**
 * A share link is read-only and bound to one dashboard. `queries:run` is
 * needed because rendering a dashboard runs its tiles' analyses — but the
 * binding, not the scope, is what stops it reading anything else.
 */
export const SHARE_SCOPES: readonly Scope[] = ["dashboards:read", "queries:run"];

/** A claim grant does one thing, once: attach an unclaimed project. */
export const CLAIM_SCOPES: readonly Scope[] = ["projects:write"];

const MEMBER: readonly Scope[] = [
  "events:read",
  "queries:run",
  "projects:read",
  "dashboards:read",
  "dashboards:write",
  "monitors:read",
  "monitors:write",
  "workspace:read",
];

const ADMIN: readonly Scope[] = [
  ...MEMBER,
  "events:write",
  "projects:write",
  "credentials:read",
  "credentials:write",
  "billing:read",
];

const OWNER: readonly Scope[] = [...ADMIN, "projects:delete", "workspace:admin", "billing:write"];

/**
 * What each role may do. Three roles, because two was not enough (v1 stored
 * only `owner`) and five would be a permissions system nobody asked for.
 *
 * Billing and deletion are the owner's alone; everything else an admin can do.
 * A member reads, and writes the things that are cheap to undo — dashboards
 * and monitors.
 */
export const ROLE_SCOPES: Record<Role, readonly Scope[]> = {
  member: MEMBER,
  admin: ADMIN,
  owner: OWNER,
};

export const roleGrants = (role: Role, scope: Scope): boolean => ROLE_SCOPES[role].includes(scope);
