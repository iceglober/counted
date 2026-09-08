/**
 * The principals and placements the matrix tests enumerate.
 *
 * Test support, deliberately not re-exported from `index.ts` — nothing outside
 * this package should build a principal from a fixture. It lives in `src`
 * rather than beside one test file because two test files enumerate the same
 * matrix (`placement.test.ts` over `covers`, `decide.test.ts` over `decide`)
 * and a second copy of the matrix is a second chance to leave a row out.
 *
 * `serviceNarrowedOwnerKey` is the important one: a key narrowed to one
 * project but carrying every permission an owner holds. Q1 cannot deny it
 * anything, so whatever it is refused, it is refused by the binding — which is
 * how the v2 defect gets isolated instead of being masked by a permission
 * check that would have caught it anyway.
 */

import {
  AccountId,
  ALL_PERMISSIONS,
  CredentialId,
  DashboardId,
  MonitorId,
  ProjectId,
  WorkspaceId,
} from "@counted/kernel";
import type { Placement, Resource } from "./placement";
import type { Principal } from "./principal";

export const W1 = WorkspaceId("ws_one");
export const W2 = WorkspaceId("ws_two");
export const P1 = ProjectId("prj_one");
export const P2 = ProjectId("prj_two");
export const P3 = ProjectId("prj_three");
export const D1 = DashboardId("dsh_one");
export const D2 = DashboardId("dsh_two");
export const M1 = MonitorId("mon_one");
export const ALICE = AccountId("acc_alice");

export const PLACEMENTS = {
  /** At the workspace itself: the workspace row, its dashboards, its billing. */
  workspaceOne: { workspace: W1, project: null },
  /** Inside a project of that workspace. */
  projectOne: { workspace: W1, project: P1 },
  /** A sibling project of the same workspace. */
  projectTwo: { workspace: W1, project: P2 },
  /** Another tenant entirely. */
  workspaceTwo: { workspace: W2, project: null },
  /** A project of that other tenant. */
  projectThree: { workspace: W2, project: P3 },
  /** A project nobody owns yet — the no-signup path. */
  unclaimedProjectOne: { workspace: null, project: P1 },
  /** Owned by nothing and inside nothing. */
  nowhere: { workspace: null, project: null },
} as const satisfies Record<string, Placement>;

export type PlacementName = keyof typeof PLACEMENTS;

export const PLACEMENT_NAMES = Object.keys(PLACEMENTS) as readonly PlacementName[];

export const PRINCIPALS = {
  anonymous: { kind: "anonymous" },

  /** Signed in, a member of W1. */
  memberOfOne: { kind: "account", account: ALICE, standing: { workspace: W1, role: "member" } },

  /** Signed in, owner of W1. */
  ownerOfOne: { kind: "account", account: ALICE, standing: { workspace: W1, role: "owner" } },

  /** Signed in, member of the other tenant. */
  ownerOfTwo: { kind: "account", account: ALICE, standing: { workspace: W2, role: "owner" } },

  /** Signed in, member of nothing that matters here. */
  stranger: { kind: "account", account: ALICE, standing: null },

  /** A workspace-wide service key carrying everything. */
  serviceWholeWorkspace: {
    kind: "service",
    credential: CredentialId("cred_all"),
    workspace: W1,
    projects: "all",
    permissions: ALL_PERMISSIONS,
    onBehalfOf: ALICE,
  },

  /** The exploit vehicle: narrowed to one project, carrying owner's holdings. */
  serviceNarrowedOwnerKey: {
    kind: "service",
    credential: CredentialId("cred_narrow"),
    workspace: W1,
    projects: [P1],
    permissions: ALL_PERMISSIONS,
    onBehalfOf: ALICE,
  },

  /** A browser key for a project inside a workspace. */
  ingestOne: {
    kind: "ingest",
    credential: CredentialId("cred_ck"),
    project: P1,
    workspace: W1,
    permissions: ["events:write"],
  },

  /** A browser key handed out before anybody signed up. */
  ingestUnclaimed: {
    kind: "ingest",
    credential: CredentialId("cred_ck_unclaimed"),
    project: P1,
    workspace: null,
    permissions: ["events:write"],
  },

  /** A share link for D1, whose tiles read from P1. */
  shareOfDashboardOne: {
    kind: "share",
    credential: CredentialId("cred_share"),
    dashboard: D1,
    projects: [P1],
    permissions: ["dashboards:read", "queries:run"],
  },
} as const satisfies Record<string, Principal>;

export type PrincipalName = keyof typeof PRINCIPALS;

export const PRINCIPAL_NAMES = Object.keys(PRINCIPALS) as readonly PrincipalName[];

/**
 * A resource whose identity never enters a binding decision, so the matrix
 * measures placement alone. A dashboard would not do: a share link is bound to
 * one by id, and that branch is tested separately.
 */
export const MONITOR: Resource = { type: "monitor", id: M1 };

export const RESOURCES: readonly Resource[] = [
  { type: "workspace", id: W1 },
  { type: "project", id: P1 },
  { type: "dashboard", id: D1 },
  { type: "monitor", id: M1 },
  { type: "credential", id: CredentialId("cred_subject") },
];
