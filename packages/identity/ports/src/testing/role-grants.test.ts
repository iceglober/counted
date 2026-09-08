import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS, ROLES, type Permission, type Role } from "@counted/kernel";
import { CREDENTIAL_KINDS } from "../credential-kind";
import { specCredentialGrants, specRoleGrants } from "./role-grants";

/**
 * V3-SPEC §4's table, written out a second time on purpose. The point of this
 * test is to pin `specRoleGrants` to the specification rather than to itself —
 * a test that re-derives the table from the code under test proves only that
 * the code is self-consistent.
 */
const SPEC: Record<Role, readonly Permission[]> = {
  member: [
    "queries:run",
    "projects:read",
    "dashboards:read",
    "dashboards:write",
    "monitors:read",
    "monitors:write",
    "workspace:read",
  ],
  admin: [
    "queries:run",
    "projects:read",
    "dashboards:read",
    "dashboards:write",
    "monitors:read",
    "monitors:write",
    "workspace:read",
    "events:write",
    "projects:write",
    "credentials:read",
    "credentials:write",
    "billing:read",
  ],
  owner: [...ALL_PERMISSIONS],
};

describe("specRoleGrants", () => {
  for (const role of ROLES) {
    test(`${role} holds exactly what V3-SPEC §4 says`, () => {
      expect([...specRoleGrants(role)].sort()).toEqual([...SPEC[role]].sort());
    });
  }

  test("the roles nest: member ⊂ admin ⊂ owner", () => {
    // Three roles ordered by authority is the whole model. A permission an
    // admin holds and an owner does not would make `Role.atLeast` a lie.
    const held = (r: Role) => new Set<Permission>(specRoleGrants(r));
    const admin = held("admin");
    const owner = held("owner");
    for (const p of held("member")) expect(admin.has(p)).toBe(true);
    for (const p of admin) expect(owner.has(p)).toBe(true);
  });

  test("an owner holds all fifteen", () => {
    expect(specRoleGrants("owner").length).toBe(ALL_PERMISSIONS.length);
    expect(ALL_PERMISSIONS.length).toBe(15);
  });
});

describe("specCredentialGrants", () => {
  test("a key never carries more than its issuer holds", () => {
    for (const role of ROLES) {
      const held = new Set<Permission>(specRoleGrants(role));
      for (const kind of CREDENTIAL_KINDS) {
        for (const permission of specCredentialGrants(kind, role)) {
          expect(held.has(permission)).toBe(true);
        }
      }
    }
  });

  test("the two owner-only permissions a bearer token must never carry", () => {
    // Changing who owns the workspace and changing what it pays stay with a
    // human in a session. This is the ceiling `@counted/projects-domain`
    // states; the double restates it and `apps/api/src/auth/grants.test.ts`
    // asserts the two are the same set.
    for (const role of ROLES) {
      expect(specCredentialGrants("service", role)).not.toContain("workspace:admin");
      expect(specCredentialGrants("service", role)).not.toContain("billing:write");
    }
  });

  test("deleting a project is delegable, and only by an owner", () => {
    expect(specCredentialGrants("service", "owner")).toContain("projects:delete");
    expect(specCredentialGrants("service", "admin")).not.toContain("projects:delete");
  });
});
