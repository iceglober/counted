import { describe, expect, test } from "bun:test";
import {
  ALL_PERMISSIONS,
  Role,
  isPermission,
  splitPermission,
  type Permission,
} from "./authz";

describe("the permission vocabulary is closed and deliberate", () => {
  test("fifteen permissions, no duplicates", () => {
    expect(ALL_PERMISSIONS).toHaveLength(15);
    expect(new Set(ALL_PERMISSIONS).size).toBe(15);
  });

  test("the v2 permission nothing checked is gone", () => {
    // Dropped rather than ported: no route required it, and a permission
    // nothing checks cannot be reasoned about.
    expect(isPermission("events:read")).toBe(false);
  });

  test("projects:delete is in the vocabulary, because a route requires it", () => {
    // It was dropped with `events:read` and restored on its own: `DELETE
    // /v1/projects/{projectId}` needs owner authority, and the alternative was
    // `projects:write` plus a role floor checked separately from `decide`.
    expect(isPermission("projects:delete")).toBe(true);
  });

  test("every permission is exactly resource:action", () => {
    for (const p of ALL_PERMISSIONS) {
      expect(p.split(":")).toHaveLength(2);
      const { resource, action } = splitPermission(p);
      expect(resource.length).toBeGreaterThan(0);
      expect(action.length).toBeGreaterThan(0);
      expect(`${resource}:${action}`).toBe(p);
    }
  });

  test("isPermission rejects anything outside the set", () => {
    expect(isPermission("workspace:admin" satisfies Permission)).toBe(true);
    expect(isPermission("workspace:delete")).toBe(false);
    expect(isPermission("")).toBe(false);
    expect(isPermission(null)).toBe(false);
  });
});

describe("roles are ordered by authority", () => {
  test("owner outranks admin outranks member", () => {
    expect(Role.rank("owner")).toBeGreaterThan(Role.rank("admin"));
    expect(Role.rank("admin")).toBeGreaterThan(Role.rank("member"));
  });

  test("atLeast is inclusive at the boundary", () => {
    expect(Role.atLeast("admin", "admin")).toBe(true);
    expect(Role.atLeast("owner", "admin")).toBe(true);
    expect(Role.atLeast("member", "admin")).toBe(false);
  });

  test("Role.is rejects a string that merely looks like one", () => {
    expect(Role.is("owner")).toBe(true);
    expect(Role.is("Owner")).toBe(false);
    expect(Role.is("superuser")).toBe(false);
  });
});
