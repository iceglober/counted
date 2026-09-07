/**
 * One rule, three statements, and this is what keeps them the same statement.
 *
 * The rule is "what may a credential of this kind, issued by this role,
 * carry". It is written three times because three packages need it and none of
 * them may import the other two:
 *
 *   1. `@counted/authorization` — role → permissions, through `accesscontrol`.
 *   2. `@counted/projects-domain` — the credential-kind ceiling, as a pure
 *      function of the permissions held.
 *   3. `specCredentialGrants` in `@counted/identity-ports/testing` — the
 *      double every fake and every port contract suite runs on, because a
 *      ports package may import neither of the first two.
 *
 * `apps/api` is the composition root and the only layer that can see all
 * three. So this file is where the copies are compared. Without it, the
 * double drifts and every test below it keeps passing while production does
 * something else — which is exactly what had happened: the version in
 * `@counted/identity-ports` had no ceiling at all.
 */

import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS, ROLES, type Permission } from "@counted/kernel";
import { permissionsForRole } from "@counted/authorization";
import { CREDENTIAL_KINDS } from "@counted/identity-ports";
import { specCredentialGrants, specRoleGrants } from "@counted/identity-ports/testing";
import { grantableTo, SERVICE_DELEGABLE_PERMISSIONS, withinGrant } from "@counted/projects-domain";
import { credentialGrants } from "./grants";

describe("the test double and the real grant table are the same table", () => {
  for (const role of ROLES) {
    test(`${role} holds the same set in both`, () => {
      expect([...specRoleGrants(role)]).toEqual([...permissionsForRole(role)]);
    });
  }
});

describe("the test double and the real derivation are the same derivation", () => {
  for (const role of ROLES) {
    for (const kind of CREDENTIAL_KINDS) {
      test(`a ${kind} key issued by ${role} carries the same set in both`, () => {
        expect([...specCredentialGrants(kind, role)]).toEqual([...credentialGrants(kind, role)]);
      });
    }
  }
});

describe("the ceiling that survived the collapse is the strict one", () => {
  test("no service key carries workspace:admin or billing:write, even for an owner", () => {
    // Losing this would issue keys more powerful than v2's escalation bug
    // allowed: a bearer token with a months-long life that can change who owns
    // the workspace and what it pays.
    for (const role of ROLES) {
      expect(credentialGrants("service", role)).not.toContain("workspace:admin");
      expect(credentialGrants("service", role)).not.toContain("billing:write");
    }
  });

  test("an ingest key carries exactly events:write, or nothing", () => {
    for (const role of ROLES) {
      const granted = credentialGrants("ingest", role);
      expect(granted.length === 0 || (granted.length === 1 && granted[0] === "events:write")).toBe(
        true,
      );
    }
    // A member holds no `events:write`, so a member cannot mint one at all.
    expect(credentialGrants("ingest", "member")).toEqual([]);
    expect(credentialGrants("ingest", "admin")).toEqual(["events:write"]);
  });

  test("nothing a key carries is outside what its issuer holds", () => {
    for (const role of ROLES) {
      const held = new Set<Permission>(permissionsForRole(role));
      for (const kind of CREDENTIAL_KINDS) {
        for (const permission of credentialGrants(kind, role)) {
          expect(held.has(permission)).toBe(true);
        }
      }
    }
  });

  test("the ceiling is the vocabulary minus exactly two permissions", () => {
    // An equality rather than a spot check, so the exclusion list is exactly
    // two and adding a permission to the vocabulary forces a decision about
    // this file rather than defaulting either way.
    expect([...SERVICE_DELEGABLE_PERMISSIONS]).toEqual(
      ALL_PERMISSIONS.filter((p) => p !== "workspace:admin" && p !== "billing:write"),
    );
  });
});

describe("issuance no longer mints a key it has to revoke", () => {
  /**
   * THE BUG, pinned. `issueCredential` computes the ceiling with `grantableTo`
   * and then asserts the store's answer is contained in it; the store computed
   * its answer with a function that had no ceiling. For an owner the two
   * disagreed on `workspace:admin` and `billing:write`, so the key was
   * created, the containment check failed, and the use case revoked the key it
   * had just minted and returned `PermissionEscalation`. An owner could not
   * issue a service key at all.
   */
  /** `issueCredential`, in three lines: the ceiling, then the containment check. */
  const survivesIssuance = (kind: "ingest" | "service", role: "owner" | "admin" | "member") => {
    const ceiling = grantableTo(kind, permissionsForRole(role));
    if (!ceiling.ok) return { minted: false as const };
    const contained = withinGrant(credentialGrants(kind, role), ceiling.value);
    return { minted: true as const, kept: contained.ok };
  };

  test("what the store derives passes the containment check the app runs", () => {
    for (const role of ROLES) {
      for (const kind of CREDENTIAL_KINDS) {
        const outcome = survivesIssuance(kind, role);
        if (!outcome.minted) continue;
        expect(outcome.kept, `${role} issuing ${kind}`).toBe(true);
      }
    }
  });

  test("specifically: an owner can issue a service key", () => {
    // The exact call that failed: the store answered with all fifteen, the
    // ceiling said thirteen, and the excess was `workspace:admin` and
    // `billing:write`.
    expect(credentialGrants("service", "owner").length).toBeGreaterThan(0);
    expect(survivesIssuance("service", "owner")).toEqual({ minted: true, kept: true });
  });
});
