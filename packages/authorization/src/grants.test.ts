/**
 * Q1. The table is asserted against a SECOND, independent transcription of
 * V3-SPEC §4 — permission-major, where `grants.ts` is role-major and uses
 * inheritance. Comparing the expansion against the data it was built from
 * would prove only that `filter` works; comparing it against the table
 * transposed is what catches an `extend` pointing at the wrong role.
 */

import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS, ROLES, type Permission, type Role } from "@counted/kernel";
import { permissionsForRole, permits, rolesHolding } from "./grants";

/** V3-SPEC §4, transcribed permission-by-permission. */
const HELD_BY: Readonly<Record<Permission, readonly Role[]>> = {
  "queries:run": ["member", "admin", "owner"],
  "projects:read": ["member", "admin", "owner"],
  "dashboards:read": ["member", "admin", "owner"],
  "dashboards:write": ["member", "admin", "owner"],
  "monitors:read": ["member", "admin", "owner"],
  "monitors:write": ["member", "admin", "owner"],
  "workspace:read": ["member", "admin", "owner"],
  "events:write": ["admin", "owner"],
  "projects:write": ["admin", "owner"],
  "credentials:read": ["admin", "owner"],
  "credentials:write": ["admin", "owner"],
  "billing:read": ["admin", "owner"],
  "projects:delete": ["owner"],
  "workspace:admin": ["owner"],
  "billing:write": ["owner"],
};

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

describe("the grant table", () => {
  test("every permission is held by exactly the roles the spec says", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(sorted(rolesHolding(permission))).toEqual(sorted(HELD_BY[permission]));
    }
  });

  test("the vocabulary and the table describe the same fifteen permissions", () => {
    // A permission with no row here would silently be held by nobody, which is
    // a route that can never be called and a test that never notices.
    expect(sorted(Object.keys(HELD_BY))).toEqual(sorted(ALL_PERMISSIONS));
  });

  test("authority is a ladder: owner holds everything admin holds, admin everything member holds", () => {
    const member = permissionsForRole("member");
    const admin = permissionsForRole("admin");
    const owner = permissionsForRole("owner");

    for (const p of member) expect(admin).toContain(p);
    for (const p of admin) expect(owner).toContain(p);
    expect(owner.length).toBe(ALL_PERMISSIONS.length);
  });

  test("no role holds a permission outside the vocabulary", () => {
    for (const role of ROLES) {
      for (const permission of permissionsForRole(role)) {
        expect(ALL_PERMISSIONS).toContain(permission);
      }
    }
  });

  test("paying, workspace administration and deletion are the owner's alone", () => {
    expect(permits("admin", "billing:write")).toBe(false);
    expect(permits("admin", "workspace:admin")).toBe(false);
    expect(permits("admin", "projects:delete")).toBe(false);
    expect(permits("owner", "billing:write")).toBe(true);
    expect(permits("owner", "workspace:admin")).toBe(true);
    expect(permits("owner", "projects:delete")).toBe(true);
  });

  test("an admin may rename a project and may not delete one", () => {
    // The distinction the fifteenth permission exists to make. Sharing
    // `projects:write` between the two put deletion behind a floor that
    // `decide` could not express, so the caller ran a second check by hand.
    expect(permits("admin", "projects:write")).toBe(true);
    expect(permits("admin", "projects:delete")).toBe(false);
  });

  test("a member cannot mint the permission an ingest key carries", () => {
    // events:write is deliberately not a member permission: it is what an
    // ingest credential carries, and Q3 computes a credential's set from the
    // issuer's role. Granting it here would let any member write into the
    // workspace's data through a key.
    expect(permits("member", "events:write")).toBe(false);
  });
});

describe("fail-closed", () => {
  test("an unrecognised role is denied rather than throwing", () => {
    // accesscontrol throws "Role not found" for an unknown role. An
    // authorization function that throws is one a `catch` upstream can turn
    // into an allow, so the wrapper answers false instead.
    const notARole = "root" as Role;
    expect(() => permits(notARole, "workspace:read")).not.toThrow();
    expect(permits(notARole, "workspace:read")).toBe(false);
    expect(permissionsForRole(notARole)).toEqual([]);
  });

  test("an unrecognised permission is denied rather than parsed", () => {
    // A typo in a route's declaration must lock the route, not open it.
    const typo = "dashboards:wrote" as Permission;
    expect(permits("owner", typo)).toBe(false);
  });

  test("a permission with no colon does not crash the split", () => {
    const malformed = "owner" as Permission;
    expect(permits("owner", malformed)).toBe(false);
  });
});
