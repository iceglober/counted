import { expect, test } from "bun:test";
import { decide, decideUnplaced, permissionsHeldBy } from "./decide";
import { ALICE, W1, PLACEMENTS } from "./fixtures";
import type { Principal } from "./principal";

test("OAuth consent is a ceiling on current role, including unplaced permission checks", () => {
  const principal: Principal = { kind: "account", account: ALICE, standing: { workspace: W1, role: "owner" }, permissionCeiling: ["projects:read"] };
  expect(permissionsHeldBy(principal)).toEqual(["projects:read"]);
  expect(decide(principal, "projects:read", PLACEMENTS.workspaceOne, { type: "workspace", id: W1 }).allow).toBe(true);
  expect(decide(principal, "billing:write", PLACEMENTS.workspaceOne, { type: "workspace", id: W1 }).allow).toBe(false);
  expect(decideUnplaced(principal, { kind: "permission", permission: "billing:write" }, [{ workspace: W1, role: "owner" }]).allow).toBe(false);
  expect(permissionsHeldBy({ ...principal, standing: null })).toEqual([]);
  expect(permissionsHeldBy({ ...principal, permissionCeiling: ["billing:write"], standing: { workspace: W1, role: "member" } })).toEqual([]);
});
