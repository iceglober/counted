import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS, ROLES, type Permission } from "@counted/kernel";
import {
  CREDENTIAL_KINDS,
  CREDENTIAL_PREFIX,
  credentialHint,
  credentialKindOf,
  isCredentialKind,
  type CredentialGrants,
} from "./credential-kind";
import { specCredentialGrants, specRoleGrants } from "./testing/role-grants";

describe("credential kinds", () => {
  test("the two prefixes are distinct, or classification is a coin toss", () => {
    expect(CREDENTIAL_PREFIX.ingest).not.toBe(CREDENTIAL_PREFIX.service);
  });

  test("a secret is classified by prefix alone", () => {
    expect(credentialKindOf("ck_abc")).toBe("ingest");
    expect(credentialKindOf("sk_abc")).toBe("service");
  });

  test("an unrecognised secret classifies as nothing, not as a default", () => {
    // Defaulting here would route an attacker's string into a real key store.
    expect(credentialKindOf("bearer abc")).toBeNull();
    expect(credentialKindOf("")).toBeNull();
  });

  test("isCredentialKind rejects anything outside the two", () => {
    expect(isCredentialKind("ingest")).toBe(true);
    expect(isCredentialKind("share")).toBe(false);
    expect(isCredentialKind(null)).toBe(false);
  });
});

describe("credentialHint", () => {
  test("keeps the prefix, so a list can be read at a glance", () => {
    expect(credentialHint("sk_abcdefgh").startsWith("sk_")).toBe(true);
  });

  test("is never a verbatim slice of the secret", () => {
    // The ellipsis is load-bearing: it is what makes a substring test fail.
    const secret = "ck_abcdefghijklmnop";
    const hint = credentialHint(secret);
    expect(secret.includes(hint)).toBe(false);
    expect(hint.length).toBeLessThan(secret.length);
  });

  test("reveals at most four characters past the prefix", () => {
    const hint = credentialHint("sk_abcdefghijklmnop");
    expect(hint).toBe("sk_abcd…");
  });

  test("survives a secret with no prefix it recognises", () => {
    // Not a valid secret, but a hint is display code and must not throw on one.
    expect(credentialHint("plain")).toBe("plai…");
  });
});

/**
 * The derivation itself no longer lives in this package — it arrives as a
 * `CredentialGrants` from the composition root, because the grant table is
 * `@counted/authorization`'s and the credential-kind ceiling is
 * `@counted/projects-domain`'s and a ports package may import neither.
 *
 * What is still testable here is the *shape* of that seam: the properties any
 * supplied derivation must have, checked against the spec double. Whether the
 * double matches the real composition is asserted in
 * `apps/api/src/auth/grants.test.ts`, which is the only place both are visible.
 */
describe("the CredentialGrants seam", () => {
  test("an ingest key is capped at events:write for every role", () => {
    for (const role of ROLES) {
      expect([...specCredentialGrants("ingest", role)].every((p) => p === "events:write")).toBe(
        true,
      );
    }
  });

  test("a member gets nothing from an ingest key, because events:write is admin-and-up", () => {
    expect(specCredentialGrants("ingest", "member")).toEqual([]);
  });

  test("a service key stops short of what an owner holds", () => {
    // The ceiling that used to be missing here. `grantablePermissions` capped
    // `service` at ALL_PERMISSIONS, so an owner's key came back carrying
    // workspace:admin and billing:write — which the projects app then refused,
    // minting a key and revoking it in the same call.
    const owner = specCredentialGrants("service", "owner");
    expect(owner).not.toContain("workspace:admin");
    expect(owner).not.toContain("billing:write");
    expect(owner.length).toBeLessThan(specRoleGrants("owner").length);
  });

  test("nothing survives that the issuer does not hold", () => {
    // Authorization's third question, answered by construction. A derivation
    // that handed an admin an owner permission would fail here first.
    for (const role of ROLES) {
      const held = new Set<Permission>(specRoleGrants(role));
      for (const kind of CREDENTIAL_KINDS) {
        for (const permission of specCredentialGrants(kind, role)) {
          expect(held.has(permission)).toBe(true);
        }
      }
    }
  });

  test("the order is ALL_PERMISSIONS order, so two derivations compare equal", () => {
    const granted = specCredentialGrants("service", "owner");
    const indices = granted.map((p) => ALL_PERMISSIONS.indexOf(p));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  test("the seam takes the kind and the role, and nothing else", () => {
    // A derivation that could read anything more — a request, a store, a
    // clock — would be a decision rather than an expansion.
    const derivation: CredentialGrants = specCredentialGrants;
    expect(derivation.length).toBe(2);
  });
});
