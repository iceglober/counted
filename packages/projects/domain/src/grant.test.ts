import { describe, expect, test } from "bun:test";
import type { Permission } from "@counted/kernel";
import {
  grantableTo,
  INGEST_PERMISSIONS,
  SERVICE_DELEGABLE_PERMISSIONS,
  withinGrant,
} from "./grant";

/**
 * The role expansions from V3-SPEC §4, written out here rather than imported.
 * `@counted/authorization` owns the grant table and a domain may not import it;
 * copying the three sets into the test is what keeps this file a test of the
 * *rule* rather than of the table.
 */
const MEMBER: readonly Permission[] = [
  "queries:run",
  "projects:read",
  "dashboards:read",
  "dashboards:write",
  "monitors:read",
  "monitors:write",
  "workspace:read",
];
const ADMIN: readonly Permission[] = [
  ...MEMBER,
  "events:write",
  "projects:write",
  "credentials:read",
  "credentials:write",
  "billing:read",
];
const OWNER: readonly Permission[] = [...ADMIN, "workspace:admin", "billing:write"];

describe("Q3 — no credential may carry a permission its issuer does not hold", () => {
  test("an admin cannot mint a key with owner permissions", () => {
    // This is the v2 hole, stated as a test. Issuing required credentials:write,
    // which admin holds; workspace:admin and billing:write are owner-only. v2
    // copied the requested scopes onto the key with no check at all, so an
    // admin minted an owner key and acted through it.
    const escalated = withinGrant(["billing:write", "workspace:admin"], ADMIN);
    expect(escalated).toEqual({
      ok: false,
      error: {
        kind: "PermissionEscalation",
        requested: ["billing:write", "workspace:admin"],
        held: [...ADMIN],
      },
    });
  });

  test("the refusal names the excess, not the whole request", () => {
    // 'you asked for billing:write and do not have it' is actionable;
    // 'one of these five is wrong' is not.
    const refused = withinGrant(["queries:run", "projects:read", "billing:write"], ADMIN);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.error).toEqual({
      kind: "PermissionEscalation",
      requested: ["billing:write"],
      held: [...ADMIN],
    });
  });

  test("an empty request is refused before the subset check", () => {
    expect(withinGrant([], OWNER)).toEqual({ ok: false, error: { kind: "PermissionsRequired" } });
  });

  test("a subset of what the issuer holds passes", () => {
    expect(withinGrant(["dashboards:read"], MEMBER)).toEqual({
      ok: true,
      value: ["dashboards:read"],
    });
  });
});

describe("grantableTo — the only place a permission set is authored", () => {
  test("an ingest key carries exactly events:write, whatever the issuer holds", () => {
    // Ingest keys ship in browser bundles. Any second permission on this list
    // makes 'somebody can send you events you did not send' a longer sentence.
    for (const held of [ADMIN, OWNER]) {
      expect(grantableTo("ingest", held)).toEqual({ ok: true, value: ["events:write"] });
    }
    expect(INGEST_PERMISSIONS).toEqual(["events:write"]);
  });

  test("an issuer who cannot write events cannot mint something that can", () => {
    // A member holds no events:write, so there is nothing to delegate. Without
    // this the ingest branch would be a hole big enough to drive the whole
    // grant-subset rule through.
    expect(grantableTo("ingest", MEMBER)).toEqual({
      ok: false,
      error: { kind: "PermissionEscalation", requested: ["events:write"], held: [...MEMBER] },
    });
  });

  test("a service key gets the issuer's set, intersected with what a key may ever carry", () => {
    const owner = grantableTo("service", OWNER);
    expect(owner.ok).toBe(true);
    if (!owner.ok) throw new Error("unreachable");
    // The two the owner holds and the key may not: a bearer token with no
    // session must not be able to change who owns the workspace or what it pays.
    expect(owner.value).not.toContain("workspace:admin");
    expect(owner.value).not.toContain("billing:write");
    expect(owner.value).toContain("credentials:write");
  });

  test("a service key never out-ranks its issuer either", () => {
    const admin = grantableTo("service", ADMIN);
    const member = grantableTo("service", MEMBER);
    expect(admin.ok && member.ok).toBe(true);
    if (!admin.ok || !member.ok) throw new Error("unreachable");
    expect(admin.value).toContain("events:write");
    expect(member.value).not.toContain("events:write");
    expect(member.value).not.toContain("credentials:write");
    for (const p of member.value) expect(MEMBER).toContain(p);
  });

  test("an issuer with nothing delegable is refused rather than given an empty key", () => {
    // An empty permission set on a live credential is worse than no credential:
    // it authenticates and then fails every authorization, which reads as a
    // broken server rather than a refused request.
    expect(grantableTo("service", [])).toEqual({
      ok: false,
      error: { kind: "PermissionsRequired" },
    });
  });

  test("the delegable list is a subset of the vocabulary, so a typo cannot widen it", () => {
    for (const p of SERVICE_DELEGABLE_PERMISSIONS) {
      expect(withinGrant([p], SERVICE_DELEGABLE_PERMISSIONS).ok).toBe(true);
    }
    expect(SERVICE_DELEGABLE_PERMISSIONS).not.toContain("workspace:admin");
    expect(SERVICE_DELEGABLE_PERMISSIONS).not.toContain("billing:write");
  });
});
