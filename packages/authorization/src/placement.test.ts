/**
 * Q2, exhaustively: every principal kind × every resource placement.
 *
 * The matrix below is a literal table, not a computation, because the point of
 * it is to be READ. v2's defect was one `return ALLOW` inside a switch, and it
 * survived review; it would not survive a row in a table that says
 * `[narrowed key, resource at the workspace] -> covered`.
 *
 * 10 principals × 7 placements = 70 rows, and a test asserts the table has all
 * 70 so a fixture added later cannot quietly go unmeasured.
 */

import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS } from "@counted/kernel";
import { decide } from "./decide";
import {
  D1,
  D2,
  M1,
  MONITOR,
  P1,
  P2,
  PLACEMENT_NAMES,
  PLACEMENTS,
  PRINCIPAL_NAMES,
  PRINCIPALS,
  W1,
  type PlacementName,
  type PrincipalName,
} from "./fixtures";
import { bindingOf, covers, isCovered, type Coverage, type CoverageGap } from "./placement";

type Cell = "covered" | CoverageGap;

const cell = (c: Coverage): Cell => (c.covered ? "covered" : c.gap);

/**
 * The whole of Q2, for a resource whose identity is not itself a binding.
 *
 * Read the `serviceNarrowedOwnerKey` row against the `serviceWholeWorkspace`
 * row above it: identical workspace, identical permissions, and the narrowed
 * key reaches strictly less. In v2 those two rows were the same.
 */
const MATRIX: Readonly<Record<PrincipalName, Readonly<Record<PlacementName, Cell>>>> = {
  anonymous: {
    workspaceOne: "BoundToNothing",
    projectOne: "BoundToNothing",
    projectTwo: "BoundToNothing",
    workspaceTwo: "BoundToNothing",
    projectThree: "BoundToNothing",
    unclaimedProjectOne: "BoundToNothing",
    nowhere: "BoundToNothing",
  },
  memberOfOne: {
    workspaceOne: "covered",
    projectOne: "covered",
    projectTwo: "covered",
    workspaceTwo: "DifferentWorkspace",
    projectThree: "DifferentWorkspace",
    unclaimedProjectOne: "Unplaced",
    nowhere: "Unplaced",
  },
  ownerOfOne: {
    workspaceOne: "covered",
    projectOne: "covered",
    projectTwo: "covered",
    workspaceTwo: "DifferentWorkspace",
    projectThree: "DifferentWorkspace",
    unclaimedProjectOne: "Unplaced",
    nowhere: "Unplaced",
  },
  ownerOfTwo: {
    workspaceOne: "DifferentWorkspace",
    projectOne: "DifferentWorkspace",
    projectTwo: "DifferentWorkspace",
    workspaceTwo: "covered",
    projectThree: "covered",
    unclaimedProjectOne: "Unplaced",
    nowhere: "Unplaced",
  },
  stranger: {
    workspaceOne: "BoundToNothing",
    projectOne: "BoundToNothing",
    projectTwo: "BoundToNothing",
    workspaceTwo: "BoundToNothing",
    projectThree: "BoundToNothing",
    unclaimedProjectOne: "BoundToNothing",
    nowhere: "BoundToNothing",
  },
  serviceWholeWorkspace: {
    workspaceOne: "covered",
    projectOne: "covered",
    projectTwo: "covered",
    workspaceTwo: "DifferentWorkspace",
    projectThree: "DifferentWorkspace",
    unclaimedProjectOne: "Unplaced",
    nowhere: "Unplaced",
  },
  serviceNarrowedOwnerKey: {
    // The v2 bug, refused. Every one of these was `covered` before.
    workspaceOne: "PlacedAboveBinding",
    projectOne: "covered",
    projectTwo: "DifferentProject",
    workspaceTwo: "PlacedAboveBinding",
    projectThree: "DifferentProject",
    // The project id matches, but this key belongs to a workspace and the
    // project belongs to none, so a leaked project id buys nothing.
    unclaimedProjectOne: "DifferentWorkspace",
    nowhere: "PlacedAboveBinding",
  },
  ingestOne: {
    workspaceOne: "PlacedAboveBinding",
    projectOne: "covered",
    projectTwo: "DifferentProject",
    workspaceTwo: "PlacedAboveBinding",
    projectThree: "DifferentProject",
    unclaimedProjectOne: "DifferentWorkspace",
    nowhere: "PlacedAboveBinding",
  },
  ingestUnclaimed: {
    workspaceOne: "PlacedAboveBinding",
    // Still works after the project is claimed: the key is bound to the
    // project and the project moved with it.
    projectOne: "covered",
    projectTwo: "DifferentProject",
    workspaceTwo: "PlacedAboveBinding",
    projectThree: "DifferentProject",
    // The no-signup path. v1 made this a 404 and the key handed out by
    // provisioning could not send a single event.
    unclaimedProjectOne: "covered",
    nowhere: "PlacedAboveBinding",
  },
  shareOfDashboardOne: {
    workspaceOne: "PlacedAboveBinding",
    projectOne: "covered",
    projectTwo: "DifferentProject",
    workspaceTwo: "PlacedAboveBinding",
    projectThree: "DifferentProject",
    unclaimedProjectOne: "covered",
    nowhere: "PlacedAboveBinding",
  },
};

describe("the placement matrix", () => {
  test("the table measures every principal against every placement", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...PRINCIPAL_NAMES].sort());
    for (const principal of PRINCIPAL_NAMES) {
      expect(Object.keys(MATRIX[principal]).sort()).toEqual([...PLACEMENT_NAMES].sort());
    }
    const rows = PRINCIPAL_NAMES.length * PLACEMENT_NAMES.length;
    expect(rows).toBe(70);
  });

  for (const principal of PRINCIPAL_NAMES) {
    for (const placement of PLACEMENT_NAMES) {
      test(`${principal} × ${placement} -> ${MATRIX[principal][placement]}`, () => {
        const actual = covers(
          bindingOf(PRINCIPALS[principal]),
          PLACEMENTS[placement],
          MONITOR,
        );
        expect(cell(actual)).toBe(MATRIX[principal][placement]);
      });
    }
  }
});

describe("the v2 defect", () => {
  /**
   * The exact exploit, spelled out. A service key issued on project A, still
   * narrowed to project A, carrying every permission an owner holds — so
   * nothing but the binding can stop it.
   *
   * In v2 `decide` short-circuited on `placement.project === null` and each of
   * these returned `{ allow: true }`.
   */
  const key = PRINCIPALS.serviceNarrowedOwnerKey;

  test("cannot delete a workspace-placed dashboard", () => {
    const d = decide(key, "dashboards:write", PLACEMENTS.workspaceOne, {
      type: "dashboard",
      id: D1,
    });
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.denial.reason).toBe("OutOfBinding");
    expect(d.allow === false && d.denial.reason === "OutOfBinding" && d.denial.gap).toBe(
      "PlacedAboveBinding",
    );
  });

  test("cannot rename the workspace", () => {
    const d = decide(key, "workspace:admin", PLACEMENTS.workspaceOne, {
      type: "workspace",
      id: W1,
    });
    expect(d.allow).toBe(false);
  });

  test("cannot open a billing checkout", () => {
    const d = decide(key, "billing:write", PLACEMENTS.workspaceOne, { type: "workspace", id: W1 });
    expect(d.allow).toBe(false);
  });

  test("cannot read the workspace's credentials", () => {
    const d = decide(key, "credentials:read", PLACEMENTS.workspaceOne, {
      type: "workspace",
      id: W1,
    });
    expect(d.allow).toBe(false);
  });

  test("cannot reach a sibling project", () => {
    for (const permission of ALL_PERMISSIONS) {
      const d = decide(key, permission, PLACEMENTS.projectTwo, { type: "project", id: P2 });
      expect(d.allow).toBe(false);
    }
  });

  test("still does its job inside the project it was issued on", () => {
    const d = decide(key, "events:write", PLACEMENTS.projectOne, { type: "project", id: P1 });
    expect(d.allow).toBe(true);
  });

  test("no project-bound principal reaches anything placed at a workspace", () => {
    // The property behind the four cases above, over the whole vocabulary and
    // every resource type: "no project" is not "no restriction".
    const projectBound = [
      PRINCIPALS.serviceNarrowedOwnerKey,
      PRINCIPALS.ingestOne,
      PRINCIPALS.ingestUnclaimed,
      PRINCIPALS.shareOfDashboardOne,
    ];
    const atWorkspace = [PLACEMENTS.workspaceOne, PLACEMENTS.workspaceTwo, PLACEMENTS.nowhere];

    for (const principal of projectBound) {
      for (const placement of atWorkspace) {
        for (const permission of ALL_PERMISSIONS) {
          // A share link's OWN dashboard is reachable by identity and is not a
          // placement question; it is asserted separately below.
          for (const resource of [
            { type: "workspace", id: W1 },
            { type: "project", id: P1 },
            { type: "monitor", id: M1 },
          ] as const) {
            expect(decide(principal, permission, placement, resource).allow).toBe(false);
          }
        }
      }
    }
  });
});

describe("a share link is a view of one page", () => {
  const link = PRINCIPALS.shareOfDashboardOne;
  const atWorkspace = PLACEMENTS.workspaceOne;

  test("reaches its own dashboard even though the dashboard sits at the workspace", () => {
    expect(isCovered(covers(bindingOf(link), atWorkspace, { type: "dashboard", id: D1 }))).toBe(
      true,
    );
    expect(decide(link, "dashboards:read", atWorkspace, { type: "dashboard", id: D1 }).allow).toBe(
      true,
    );
  });

  test("does not reach a different dashboard in the same workspace", () => {
    const d = decide(link, "dashboards:read", atWorkspace, { type: "dashboard", id: D2 });
    expect(d.allow).toBe(false);
    expect(d.allow === false && d.denial.reason === "OutOfBinding" && d.denial.gap).toBe(
      "DifferentDashboard",
    );
  });

  test("does not reach a different dashboard even when placed in a project it may query", () => {
    // The share link may run queries against P1, which is exactly why the
    // dashboard branch is decided by identity and never by placement.
    const d = decide(link, "dashboards:read", PLACEMENTS.projectOne, {
      type: "dashboard",
      id: D2,
    });
    expect(d.allow).toBe(false);
  });
});

describe("bindingOf", () => {
  test("a member and an owner of the same workspace reach exactly the same things", () => {
    // Reach is placement; authority is permissions. Conflating them is how v1
    // ended up with four different spellings of `role !== "owner"` inline in
    // route handlers.
    for (const placement of PLACEMENT_NAMES) {
      const asMember = covers(bindingOf(PRINCIPALS.memberOfOne), PLACEMENTS[placement], MONITOR);
      const asOwner = covers(bindingOf(PRINCIPALS.ownerOfOne), PLACEMENTS[placement], MONITOR);
      expect(cell(asMember)).toBe(cell(asOwner));
    }
  });

  test("an account with no membership is bound to nothing, not to everything", () => {
    expect(bindingOf(PRINCIPALS.stranger)).toEqual({ scope: "nothing" });
  });

  test("a narrowed key and a whole-workspace key are different bindings", () => {
    expect(bindingOf(PRINCIPALS.serviceWholeWorkspace).scope).toBe("workspace");
    expect(bindingOf(PRINCIPALS.serviceNarrowedOwnerKey).scope).toBe("projects");
  });
});
