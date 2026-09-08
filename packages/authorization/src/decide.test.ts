/**
 * `decide` over the whole cross product: 10 principals × 7 placements × 5
 * resource types × 15 permissions = 5,250 decisions, checked against
 * properties rather than against a second copy of the implementation.
 *
 * A hand-written oracle would only restate `decide` and agree with it by
 * construction, including where it is wrong. These are necessary conditions
 * instead — statements that must hold whatever the implementation does — plus
 * the named scenarios that pin the behaviour we want.
 */

import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS, ROLES, type Permission } from "@counted/kernel";
import {
  allows,
  decide,
  decideUnplaced,
  explain,
  permissionsHeldBy,
  type Decision,
} from "./decide";
import {
  ALICE,
  P1,
  PLACEMENT_NAMES,
  PLACEMENTS,
  PRINCIPAL_NAMES,
  PRINCIPALS,
  RESOURCES,
  W1,
  type PlacementName,
  type PrincipalName,
} from "./fixtures";
import { permissionsForRole, permits } from "./grants";
import { bindingOf, covers, type Placement, type Resource } from "./placement";
import { Principal } from "./principal";

type Case = {
  readonly principal: PrincipalName;
  readonly placement: PlacementName;
  readonly permission: Permission;
  readonly resource: Resource;
  readonly decision: Decision;
};

/** Every decision this package can be asked to make, given the fixtures. */
const EVERY_CASE: readonly Case[] = PRINCIPAL_NAMES.flatMap((principal) =>
  PLACEMENT_NAMES.flatMap((placement) =>
    ALL_PERMISSIONS.flatMap((permission) =>
      RESOURCES.map((resource) => ({
        principal,
        placement,
        permission,
        resource,
        decision: decide(
          PRINCIPALS[principal],
          permission,
          PLACEMENTS[placement],
          resource,
        ),
      })),
    ),
  ),
);

const describeCase = (c: Case): string =>
  `${c.principal} / ${c.permission} / ${c.placement} / ${c.resource.type}`;

const allowed = EVERY_CASE.filter((c) => allows(c.decision));

describe("the whole cross product", () => {
  test("covers every combination the fixtures can express", () => {
    expect(EVERY_CASE.length).toBe(
      PRINCIPAL_NAMES.length * PLACEMENT_NAMES.length * ALL_PERMISSIONS.length * RESOURCES.length,
    );
    expect(EVERY_CASE.length).toBe(5250);
    // If nothing were ever allowed these properties would all hold vacuously.
    expect(allowed.length).toBeGreaterThan(0);
  });

  test("nothing is allowed without both the permission and the reach", () => {
    // The whole of authorization, stated once: Q1 and Q2, and never one of
    // them. Every allow in the matrix must satisfy both independently.
    for (const c of allowed) {
      const principal = PRINCIPALS[c.principal];
      expect(permissionsHeldBy(principal)).toContain(c.permission);
      expect(
        covers(bindingOf(principal), PLACEMENTS[c.placement], c.resource).covered,
      ).toBe(true);
    }
  });

  test("a denial always says why, and the reason is one of the four", () => {
    for (const c of EVERY_CASE) {
      if (c.decision.allow) continue;
      expect(["NotAuthenticated", "NotAMember", "NotPermitted", "OutOfBinding"]).toContain(
        c.decision.denial.reason,
      );
      expect(explain(c.decision.denial).length).toBeGreaterThan(0);
    }
  });

  test("deciding twice gives the same answer", () => {
    // Purity, asserted rather than assumed: a decision that consulted a clock,
    // a cache or a counter would drift, and every property above would only
    // hold for the first call.
    for (const c of EVERY_CASE) {
      const again = decide(
        PRINCIPALS[c.principal],
        c.permission,
        PLACEMENTS[c.placement],
        c.resource,
      );
      expect(again).toEqual(c.decision);
    }
  });
});

describe("invariants that hold for every principal kind", () => {
  test("anonymous is denied everything, and told only that it is unauthenticated", () => {
    for (const c of EVERY_CASE) {
      if (c.principal !== "anonymous") continue;
      expect(c.decision.allow).toBe(false);
      expect(c.decision.allow === false && c.decision.denial.reason).toBe("NotAuthenticated");
    }
  });

  test("a signed-in non-member is told that, and nothing about the resource", () => {
    for (const c of EVERY_CASE) {
      if (c.principal !== "stranger") continue;
      expect(c.decision.allow).toBe(false);
      // Not NotPermitted and not OutOfBinding: naming a permission or a
      // resource would confirm the resource exists to somebody with no
      // standing to know.
      expect(c.decision.allow === false && c.decision.denial.reason).toBe("NotAMember");
    }
  });

  test("no principal is allowed a permission it does not hold", () => {
    for (const c of allowed) {
      expect(permissionsHeldBy(PRINCIPALS[c.principal])).toContain(c.permission);
    }
  });

  test("an ingest key can only ever write events", () => {
    for (const c of allowed) {
      if (c.principal !== "ingestOne" && c.principal !== "ingestUnclaimed") continue;
      expect(c.permission).toBe("events:write");
    }
  });

  test("a share link never writes anything", () => {
    for (const c of allowed) {
      if (c.principal !== "shareOfDashboardOne") continue;
      expect(["dashboards:read", "queries:run"]).toContain(c.permission);
    }
  });

  test("no principal bound to one workspace is ever allowed anything in another", () => {
    const boundToOne: readonly PrincipalName[] = [
      "memberOfOne",
      "ownerOfOne",
      "serviceWholeWorkspace",
      "serviceNarrowedOwnerKey",
      "ingestOne",
    ];
    const inTwo: readonly PlacementName[] = ["workspaceTwo", "projectThree"];
    for (const c of allowed) {
      if (boundToOne.includes(c.principal)) expect(inTwo).not.toContain(c.placement);
    }
  });

  test("a member is never allowed what only an owner holds", () => {
    const ownerOnly: readonly Permission[] = ["workspace:admin", "billing:write"];
    for (const c of allowed) {
      if (c.principal === "memberOfOne") expect(ownerOnly).not.toContain(c.permission);
    }
  });
});

describe("a human's authority is their role in the workspace that owns the resource", () => {
  test("a member reads and writes dashboards but does not pay", () => {
    const p = PRINCIPALS.memberOfOne;
    const at = PLACEMENTS.workspaceOne;
    expect(decide(p, "dashboards:write", at, { type: "workspace", id: W1 }).allow).toBe(true);
    expect(decide(p, "billing:write", at, { type: "workspace", id: W1 }).allow).toBe(false);
    expect(decide(p, "credentials:write", at, { type: "workspace", id: W1 }).allow).toBe(false);
  });

  test("an owner of another workspace is refused by reach, not by rank", () => {
    // Both are 403 and both are correct, but only one of them is the truth,
    // and the audit log is where somebody has to work out what happened.
    const d = decide(PRINCIPALS.ownerOfTwo, "billing:write", PLACEMENTS.workspaceOne, {
      type: "workspace",
      id: W1,
    });
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.denial.reason).toBe("OutOfBinding");
  });

  test("a role read in one workspace cannot decide a question about another", () => {
    // The standing carries the workspace it was read in, so there is no way to
    // hand `decide` a role without saying where it came from. v1's session
    // object carried a bare role and this class of mistake was invisible.
    for (const role of ROLES) {
      const p = Principal.ANONYMOUS;
      expect(permissionsHeldBy(p)).toEqual([]);
      const elsewhere = {
        kind: "account",
        account: ALICE,
        standing: { workspace: W1, role },
      } as const;
      for (const permission of permissionsForRole(role)) {
        expect(
          decide(elsewhere, permission, PLACEMENTS.workspaceTwo, { type: "project", id: P1 }).allow,
        ).toBe(false);
      }
    }
  });

  test("a permission the role lacks is reported as missing, not as out of reach", () => {
    const d = decide(PRINCIPALS.memberOfOne, "billing:write", PLACEMENTS.workspaceOne, {
      type: "workspace",
      id: W1,
    });
    expect(d.allow === false && d.denial.reason).toBe("NotPermitted");
    expect(d.allow === false && d.denial.reason === "NotPermitted" && d.denial.required).toBe(
      "billing:write",
    );
  });
});

describe("permissionsHeldBy", () => {
  test("a human's set is their role expanded, computed per decision", () => {
    expect(permissionsHeldBy(PRINCIPALS.memberOfOne)).toEqual(permissionsForRole("member"));
    expect(permissionsHeldBy(PRINCIPALS.ownerOfOne)).toEqual(permissionsForRole("owner"));
  });

  test("a credential's set is its own and does not follow its issuer's role", () => {
    // The point of a key: revoking the admin who minted it must not widen it,
    // and promoting them must not either.
    expect(permissionsHeldBy(PRINCIPALS.ingestOne)).toEqual(["events:write"]);
    expect(permissionsHeldBy(PRINCIPALS.shareOfDashboardOne)).toEqual([
      "dashboards:read",
      "queries:run",
    ]);
  });

  test("nobody holds anything without standing", () => {
    expect(permissionsHeldBy(PRINCIPALS.anonymous)).toEqual([]);
    expect(permissionsHeldBy(PRINCIPALS.stranger)).toEqual([]);
  });
});

describe("Principal", () => {
  test("a key authors on behalf of the account that issued it, never a synthetic one", () => {
    // v1 fabricated `{ userId: "", role: "owner" }` for API-key requests and
    // wrote that empty id into `created_by`.
    expect(Principal.actor(PRINCIPALS.serviceWholeWorkspace)).toBe(ALICE);
    expect(Principal.actor(PRINCIPALS.memberOfOne)).toBe(ALICE);
    expect(Principal.actor(PRINCIPALS.ingestOne)).toBeNull();
    expect(Principal.actor(PRINCIPALS.shareOfDashboardOne)).toBeNull();
    expect(Principal.actor(PRINCIPALS.anonymous)).toBeNull();
  });

  test("describe leaks no secret", () => {
    for (const name of PRINCIPAL_NAMES) {
      const line = Principal.describe(PRINCIPALS[name]);
      expect(line).not.toContain("permissions");
      expect(line.length).toBeGreaterThan(0);
    }
  });
});

describe("placements nothing owns", () => {
  const nowhere: Placement = PLACEMENTS.nowhere;

  test("an unowned resource is reachable by no human, whatever their role", () => {
    // No workspace means no membership, so no role reaches it. Adoption goes
    // through a claim grant, never through authorization.
    for (const name of ["memberOfOne", "ownerOfOne", "ownerOfTwo", "stranger"] as const) {
      for (const permission of ALL_PERMISSIONS) {
        expect(decide(PRINCIPALS[name], permission, nowhere, { type: "project", id: P1 }).allow)
          .toBe(false);
      }
    }
  });

  test("an unclaimed project still accepts events from its own key", () => {
    // The whole no-signup path is this one allow.
    expect(
      decide(PRINCIPALS.ingestUnclaimed, "events:write", PLACEMENTS.unclaimedProjectOne, {
        type: "project",
        id: P1,
      }).allow,
    ).toBe(true);
  });

  test("but not from a key belonging to a workspace", () => {
    expect(
      decide(PRINCIPALS.ingestOne, "events:write", PLACEMENTS.unclaimedProjectOne, {
        type: "project",
        id: P1,
      }).allow,
    ).toBe(false);
    expect(permits("owner", "events:write")).toBe(true);
  });
});

/**
 * The routes with nothing to place. `decide` cannot answer them — it takes a
 * `Placement` and there is no resource — and before `decideUnplaced` existed
 * the composition root answered them itself, expanding roles in a
 * `reach.some(...)` of its own. That is a second policy, and the whole point of
 * this package is that there is one.
 */
describe("decideUnplaced", () => {
  const IN_ONE = { workspace: W1, role: "member" } as const;
  const OWNER_OF_ONE = { workspace: W1, role: "owner" } as const;

  test("nobody unauthenticated gets past it, whatever is asked", () => {
    for (const need of [
      { kind: "account" },
      { kind: "credential" },
      { kind: "permission", permission: "workspace:read" },
    ] as const) {
      const decision = decideUnplaced(PRINCIPALS.anonymous, need);
      expect(decision.allow).toBe(false);
      if (decision.allow) return;
      expect(decision.denial.reason).toBe("NotAuthenticated");
    }
  });

  test("a permission held in ANY workspace the caller reaches is enough", () => {
    // "List my workspaces" is exactly this question: the caller has no
    // workspace in mind, and the route returns the ones they reach.
    const need = { kind: "permission", permission: "billing:read" } as const;
    expect(decideUnplaced(PRINCIPALS.stranger, need, [OWNER_OF_ONE]).allow).toBe(true);
    expect(decideUnplaced(PRINCIPALS.stranger, need, [IN_ONE]).allow).toBe(false);
  });

  test("reaching nothing is a refusal, not a vacuous allow", () => {
    // The failure mode worth naming: `[].some(...)` is false, and an
    // implementation that defaulted to true here would open every listing
    // route to anyone with a session.
    for (const permission of ALL_PERMISSIONS) {
      const decision = decideUnplaced(PRINCIPALS.stranger, { kind: "permission", permission });
      expect(decision.allow).toBe(false);
      if (decision.allow) return;
      expect(decision.denial).toEqual({ reason: "NotPermitted", required: permission });
    }
  });

  test("a member's standing counts even when the caller passed no list", () => {
    expect(
      decideUnplaced(PRINCIPALS.memberOfOne, { kind: "permission", permission: "workspace:read" })
        .allow,
    ).toBe(true);
    expect(
      decideUnplaced(PRINCIPALS.memberOfOne, { kind: "permission", permission: "billing:read" })
        .allow,
    ).toBe(false);
  });

  test("a credential holds what it carries, wherever it was issued", () => {
    const need = { kind: "permission", permission: "events:write" } as const;
    expect(decideUnplaced(PRINCIPALS.ingestOne, need).allow).toBe(true);
    expect(decideUnplaced(PRINCIPALS.shareOfDashboardOne, need).allow).toBe(false);
    // A standing list must not widen a key: a key never inherits what its
    // issuer can do today.
    expect(decideUnplaced(PRINCIPALS.shareOfDashboardOne, need, [OWNER_OF_ONE]).allow).toBe(false);
  });

  test("an account route is answerable by a session and by a service key, and by nothing else", () => {
    // A service key answers as the account that issued it, which is what makes
    // an audit trail possible without a session. An ingest key has no account
    // behind it at all.
    const need = { kind: "account" } as const;
    expect(decideUnplaced(PRINCIPALS.memberOfOne, need).allow).toBe(true);
    expect(decideUnplaced(PRINCIPALS.stranger, need).allow).toBe(true);
    expect(decideUnplaced(PRINCIPALS.serviceWholeWorkspace, need).allow).toBe(true);
    expect(decideUnplaced(PRINCIPALS.ingestOne, need).allow).toBe(false);
    expect(decideUnplaced(PRINCIPALS.shareOfDashboardOne, need).allow).toBe(false);
  });

  test("a credential route is answerable by a key and not by a human", () => {
    const need = { kind: "credential" } as const;
    expect(decideUnplaced(PRINCIPALS.serviceWholeWorkspace, need).allow).toBe(true);
    expect(decideUnplaced(PRINCIPALS.ingestOne, need).allow).toBe(true);
    expect(decideUnplaced(PRINCIPALS.memberOfOne, need).allow).toBe(false);
    expect(decideUnplaced(PRINCIPALS.shareOfDashboardOne, need).allow).toBe(false);
  });

  test("it never reads a placement, so it cannot leak one", () => {
    // Stated as a property because the temptation is to "just" pass the
    // workspace in: the moment this function takes a placement it becomes a
    // second `decide`, and the two will disagree.
    expect(decideUnplaced.length).toBe(2);
  });
});
