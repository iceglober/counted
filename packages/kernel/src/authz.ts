/**
 * The authorization vocabulary — the words, not the policy.
 *
 * Two things are deliberately NOT here: the role-to-permission grant table and
 * the binding rules. Those are policy, they live in `@counted/authorization`,
 * and one of them imports `accesscontrol`. What lives here is the closed set of
 * nouns three otherwise-unrelated packages have to agree on:
 *
 *   `@counted/contract`   declares a permission per procedure, and that
 *                         declaration is what emits the OpenAPI `security`
 *                         block. The contract is a leaf — it may import the
 *                         kernel and nothing else — so the vocabulary has to
 *                         reach it from here.
 *   `@counted/authorization`  expands a role into permissions.
 *   `@counted/identity-*` reads a member's role out of better-auth.
 *
 * A flat `resource:action` string is the currency, exactly as in v2. That is
 * not the shape `accesscontrol` speaks — it wants action-on-resource — and the
 * translation happens inside `@counted/authorization`, which is the one module
 * allowed to know that library exists. Nothing anywhere asks "is this user an
 * owner?" directly.
 */

/**
 * Three roles, ordered by authority. Two was not enough (v1 stored only
 * `owner`) and five would be a permissions system nobody asked for.
 */
export type Role = "owner" | "admin" | "member";

export const ROLES: readonly Role[] = ["owner", "admin", "member"];

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

export const Role = {
  rank: (r: Role): number => RANK[r],
  atLeast: (actual: Role, required: Role): boolean => RANK[actual] >= RANK[required],
  is: (value: unknown): value is Role =>
    typeof value === "string" && (ROLES as readonly string[]).includes(value),
} as const;

/**
 * Fifteen permissions. v2 had sixteen; `events:read` was granted by roles and
 * required by no route, so it is dropped rather than ported — a permission
 * nothing checks is a permission nobody can reason about.
 *
 * `projects:delete` was dropped for that same reason and is back, because a
 * route now requires it. V3-SPEC §4 left the question open and answered it
 * provisionally with `projects:write` plus an owner-role floor checked at the
 * procedure — a second check, run by hand, next to the one `decide` makes.
 * That is the shape this package exists to prevent: two statements of one
 * rule, with nothing comparing them. Deletion is owner-only authority, the
 * grant table already says who is an owner, so deletion is a permission.
 */
export type Permission =
  | "events:write"
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

export const ALL_PERMISSIONS: readonly Permission[] = [
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
  "workspace:admin",
  "billing:read",
  "billing:write",
];

export const isPermission = (value: unknown): value is Permission =>
  typeof value === "string" && (ALL_PERMISSIONS as readonly string[]).includes(value);

/** The left half of a permission string. */
export type PermissionResource = Permission extends `${infer R}:${string}` ? R : never;
/** The right half. */
export type PermissionAction = Permission extends `${string}:${infer A}` ? A : never;

export const splitPermission = (
  p: Permission,
): { readonly resource: PermissionResource; readonly action: PermissionAction } => {
  const at = p.indexOf(":");
  return {
    resource: p.slice(0, at) as PermissionResource,
    action: p.slice(at + 1) as PermissionAction,
  };
};
