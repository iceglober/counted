/**
 * Translating the kernel's permission vocabulary into the shape
 * `@better-auth/api-key` stores, and back.
 *
 * A `Permission` is `resource:action`. better-auth stores a key's permissions
 * as `Record<resource, action[]>` — its `Statements` shape — and JSON-encodes
 * it into one column. The two say the same thing in different letters, and
 * this file is the only place that knows both.
 *
 * **This is a representation, not a policy.** `@counted/authorization` is the
 * single grant table, `@counted/projects-domain` is the single credential-kind
 * ceiling, the injected `CredentialGrants` composes them, and this module only
 * re-spells the result. If anything
 * here ever starts *deciding* which permissions a key gets, there are two
 * policies and no rule about which wins — which is the defect the whole
 * derivation chain exists to prevent.
 */

import { ALL_PERMISSIONS, isPermission, splitPermission, type Permission } from "@counted/kernel";

/** better-auth's shape. Named for what it is here so the vendor's word does not leak. */
export type PermissionStatements = Record<string, string[]>;

/** Group `resource:action` pairs by resource. Actions are unique and ordered. */
export const toStatements = (permissions: readonly Permission[]): PermissionStatements => {
  const grouped: PermissionStatements = {};
  for (const permission of ALL_PERMISSIONS) {
    if (!permissions.includes(permission)) continue;
    const { resource, action } = splitPermission(permission);
    (grouped[resource] ??= []).push(action);
  }
  return grouped;
};

/**
 * Flatten back, dropping anything the kernel does not recognise.
 *
 * Dropping rather than throwing is the deliberate choice. The input is a JSON
 * blob from a row that may predate a permission being renamed or removed; a
 * key carrying one unknown string should lose that one authority, not fail to
 * verify at all. The result is ordered by `ALL_PERMISSIONS` so two keys with
 * the same authority compare equal as arrays.
 */
export const fromStatements = (statements: unknown): readonly Permission[] => {
  if (statements === null || typeof statements !== "object") return [];
  const held = new Set<string>();
  for (const [resource, actions] of Object.entries(statements as Record<string, unknown>)) {
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      if (typeof action === "string") held.add(`${resource}:${action}`);
    }
  }
  return ALL_PERMISSIONS.filter((p) => held.has(p));
};

/**
 * Read the column. The plugin JSON-encodes `permissions` on write and hands it
 * back parsed on some paths and raw on others, so both are accepted here
 * rather than at every call site.
 */
export const parsePermissions = (raw: unknown): readonly Permission[] => {
  if (typeof raw !== "string") return fromStatements(raw);
  try {
    return fromStatements(JSON.parse(raw));
  } catch {
    return [];
  }
};

/** Every permission the kernel knows, as statements. Used only in tests. */
export const allStatements = (): PermissionStatements => toStatements(ALL_PERMISSIONS);

export const isKnownPermission = isPermission;
