/**
 * The decision, end to end: credential → placement → role → allow or refuse.
 *
 * These are the rules the whole architecture exists to keep, so each test
 * states one in its name. The first is the v2 bug, refused.
 */

import { describe, expect, test } from "bun:test";
import { Instant, type AccountId, type CredentialId, type DashboardId, type Permission, type ProjectId, type WorkspaceId } from "@counted/kernel";
import type { AuthorizationRequirement } from "@counted/contract";
import type { VerifiedCredential } from "@counted/identity-ports";
import { authorize, type AuthorizeDeps } from "./authorize";
import type { PlacementReader } from "./placement";

const AT = Instant.fromEpochMillis(1_700_000_000_000);
const WS = "ws_1" as WorkspaceId;
const OTHER_WS = "ws_2" as WorkspaceId;
const PROJECT = "pr_1" as ProjectId;
const OTHER_PROJECT = "pr_2" as ProjectId;
const DASHBOARD = "db_1" as DashboardId;
const ACCOUNT = "acct_1" as AccountId;

const placements: PlacementReader = {
  workspaceExists: async (workspace) => workspace === WS || workspace === OTHER_WS,
  projectPlacement: async (project) =>
    project === PROJECT || project === OTHER_PROJECT ? { workspace: WS } : undefined,
  // A dashboard is placed AT the workspace: project `null`. That is what makes
  // it unreachable by a project-narrowed key, and it is the whole point.
  dashboardWorkspace: async (dashboard) => (dashboard === DASHBOARD ? WS : undefined),
  monitorPlacement: async () => undefined,
};

type Overrides = Partial<AuthorizeDeps>;

const deps = (overrides: Overrides = {}): AuthorizeDeps => ({
  placements,
  credentials: {
    verify: async () => ({ ok: false, error: { kind: "Unknown" } }),
    issue: async () => { throw new Error("unused"); },
    rotate: async () => { throw new Error("unused"); },
    revoke: async () => { throw new Error("unused"); },
    list: async () => [],
    reassignProject: async () => 0,
  },
  memberships: { roleOf: async () => null, membersOf: async () => [] },
  session: { principal: async () => null },
  share: { resolve: async () => null },
  reach: { workspacesFor: async () => [], workspaceName: async () => "W" },
  projectWorkspace: async () => WS,
  ...overrides,
});

const keyed = (credential: VerifiedCredential, overrides: Overrides = {}): AuthorizeDeps =>
  deps({
    credentials: {
      verify: async (secret) =>
        secret === "sk_good"
          ? { ok: true, value: credential }
          : { ok: false, error: { kind: "Unknown" } },
      issue: async () => { throw new Error("unused"); },
      rotate: async () => { throw new Error("unused"); },
      revoke: async () => { throw new Error("unused"); },
      list: async () => [],
      reassignProject: async () => 0,
    },
    ...overrides,
  });

const bearer = (secret = "sk_good"): Headers =>
  new Headers({ authorization: `Bearer ${secret}` });

const serviceKey = (
  permissions: VerifiedCredential["permissions"],
  project: ProjectId | null,
): VerifiedCredential => ({
  id: "cred_1" as CredentialId,
  kind: "service",
  workspace: WS,
  project,
  permissions,
  issuedBy: ACCOUNT,
});

const resourceOn = (
  permission: Permission,
  resource: "workspace" | "project" | "dashboard",
  param: string,
): AuthorizationRequirement => ({
  kind: "resource",
  permission,
  resource,
  param,
});

describe("Q2 — binding", () => {
  /**
   * THE v2 BUG. A service key issued on one project, narrowed to that project,
   * could read, write and delete every dashboard in the workspace — because a
   * dashboard is placed at the workspace with `project: null`, and v2 read "no
   * project" as "no restriction". The two are opposites.
   */
  test("a project-narrowed key cannot reach a workspace-placed dashboard", async () => {
    const decision = await authorize(
      keyed(serviceKey(["dashboards:read"], PROJECT)),
      resourceOn("dashboards:read", "dashboard", "dashboardId"),
      bearer(),
      { dashboardId: DASHBOARD },
      AT,
    );

    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.denial?.reason).toBe("OutOfBinding");
    expect(decision.denial?.reason === "OutOfBinding" && decision.denial.gap).toBe(
      "PlacedAboveBinding",
    );
  });

  test("an unnarrowed key in the same workspace does reach it", async () => {
    const decision = await authorize(
      keyed(serviceKey(["dashboards:read"], null)),
      resourceOn("dashboards:read", "dashboard", "dashboardId"),
      bearer(),
      { dashboardId: DASHBOARD },
      AT,
    );
    expect(decision.ok).toBe(true);
  });

  test("a key narrowed to one project cannot reach a sibling project", async () => {
    const decision = await authorize(
      keyed(serviceKey(["projects:read"], PROJECT)),
      resourceOn("projects:read", "project", "projectId"),
      bearer(),
      { projectId: OTHER_PROJECT },
      AT,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.denial?.reason === "OutOfBinding" && decision.denial.gap).toBe(
      "DifferentProject",
    );
  });
});

describe("Q1 — permission, read in the workspace that owns the resource", () => {
  test("a member's role is resolved against the resource's workspace, not a carried one", async () => {
    const seen: string[] = [];
    const decision = await authorize(
      deps({
        session: { principal: async () => ({ account: ACCOUNT }) },
        memberships: {
          roleOf: async (_account, workspace) => {
            seen.push(String(workspace));
            return workspace === WS ? "member" : null;
          },
          membersOf: async () => [],
        },
      }),
      resourceOn("dashboards:read", "dashboard", "dashboardId"),
      new Headers(),
      { dashboardId: DASHBOARD },
      AT,
    );

    expect(decision.ok).toBe(true);
    expect(seen).toEqual([String(WS)]);
  });

  test("an authenticated non-member is refused", async () => {
    const decision = await authorize(
      deps({ session: { principal: async () => ({ account: ACCOUNT }) } }),
      resourceOn("dashboards:read", "dashboard", "dashboardId"),
      new Headers(),
      { dashboardId: DASHBOARD },
      AT,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.denial?.reason).toBe("NotAMember");
    // ...and the wire cannot tell that apart from any other refusal.
    expect(decision.fault.data.reason).toBe("NotPermitted");
  });

  test("a member cannot do what only an owner may", async () => {
    const decision = await authorize(
      deps({
        session: { principal: async () => ({ account: ACCOUNT }) },
        memberships: { roleOf: async () => "member", membersOf: async () => [] },
      }),
      resourceOn("workspace:admin", "workspace", "workspaceId"),
      new Headers(),
      { workspaceId: WS },
      AT,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.denial?.reason).toBe("NotPermitted");
  });
});

describe("deletion is its own authority", () => {
  /**
   * `projects.delete` used to be `projects:write` plus an owner-role floor
   * checked separately from `decide`. Two conditions, one of them invisible to
   * the authorization function, is the shape this codebase keeps paying for —
   * so deletion is `projects:delete`, the fifteenth permission, and one call
   * decides it.
   */
  test("an admin-issued service key cannot delete a project", async () => {
    // What an admin's service key actually carries: everything an admin holds
    // that a key may carry, and `projects:delete` is not among them because an
    // admin does not hold it.
    const decision = await authorize(
      keyed(
        serviceKey(
          ["projects:read", "projects:write", "credentials:read", "credentials:write", "billing:read"],
          null,
        ),
      ),
      resourceOn("projects:delete", "project", "projectId"),
      bearer(),
      { projectId: PROJECT },
      AT,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.denial).toEqual({ reason: "NotPermitted", required: "projects:delete" });
  });

  test("the same key may still rename that project", async () => {
    // The distinction the permission exists to make. Renaming is recoverable;
    // deleting takes the events with it.
    const decision = await authorize(
      keyed(serviceKey(["projects:read", "projects:write"], null)),
      resourceOn("projects:write", "project", "projectId"),
      bearer(),
      { projectId: PROJECT },
      AT,
    );
    expect(decision.ok).toBe(true);
  });

  test("an owner-issued service key can delete", async () => {
    const decision = await authorize(
      keyed(serviceKey(["projects:read", "projects:write", "projects:delete"], null)),
      resourceOn("projects:delete", "project", "projectId"),
      bearer(),
      { projectId: PROJECT },
      AT,
    );
    expect(decision.ok).toBe(true);
  });

  test("an admin at the console cannot delete either", async () => {
    const decision = await authorize(
      deps({
        session: { principal: async () => ({ account: ACCOUNT }) },
        memberships: { roleOf: async () => "admin", membersOf: async () => [] },
      }),
      resourceOn("projects:delete", "project", "projectId"),
      new Headers(),
      { projectId: PROJECT },
      AT,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.denial).toEqual({ reason: "NotPermitted", required: "projects:delete" });
  });
});

describe("credentials that did not resolve", () => {
  test("an unknown key is anonymous, and the answer carries no detail", async () => {
    const decision = await authorize(
      deps(),
      resourceOn("projects:read", "project", "projectId"),
      bearer("sk_nope"),
      { projectId: PROJECT },
      AT,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.fault.code).toBe("UNAUTHORIZED");
    expect(decision.fault.data).toEqual({ reason: "NotAuthenticated" });
  });

  /**
   * `RateLimited` does not collapse. Back off is an instruction the caller can
   * act on, and withholding it just produces more requests.
   */
  test("a rate-limited key is told to back off, not that it is unknown", async () => {
    const decision = await authorize(
      deps({
        credentials: {
          verify: async () => ({
            ok: false,
            error: { kind: "RateLimited", retryAfter: Instant.between(AT, AT) as never },
          }),
          issue: async () => { throw new Error("unused"); },
          rotate: async () => { throw new Error("unused"); },
          revoke: async () => { throw new Error("unused"); },
          list: async () => [],
          reassignProject: async () => 0,
        },
      }),
      resourceOn("projects:read", "project", "projectId"),
      bearer(),
      { projectId: PROJECT },
      AT,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.fault.code).toBe("TOO_MANY_REQUESTS");
  });
});

describe("share links", () => {
  const shareDeps = (dashboard: DashboardId) =>
    deps({
      share: {
        resolve: async (token) =>
          token === "good"
            ? { credential: "share_1" as CredentialId, dashboard, projects: [PROJECT] }
            : null,
      },
    });

  test("a wrong token and an unshared dashboard are the same answer", async () => {
    const wrong = await authorize(
      shareDeps(DASHBOARD),
      { kind: "share" },
      new Headers(),
      { shareToken: "bad" },
      AT,
    );
    const missing = await authorize(
      deps(),
      { kind: "share" },
      new Headers(),
      { shareToken: "anything" },
      AT,
    );

    expect(wrong.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (wrong.ok || missing.ok) return;
    expect(wrong.fault).toEqual(missing.fault);
    // And it is a 404, not a 401 or a 403 — either would say a live link exists.
    expect(wrong.fault.code).toBe("NOT_FOUND");
  });

  test("a token opens the dashboard it was minted for", async () => {
    const decision = await authorize(
      shareDeps(DASHBOARD),
      { kind: "share" },
      new Headers(),
      { shareToken: "good" },
      AT,
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.authority.principal.kind).toBe("share");
  });

  /**
   * A share token presented to a route that does not declare one authenticates
   * nothing. Otherwise a token in a query string would be a credential for the
   * whole API.
   */
  test("a share token does not authenticate a route that never asked for one", async () => {
    const decision = await authorize(
      shareDeps(DASHBOARD),
      resourceOn("dashboards:read", "dashboard", "dashboardId"),
      new Headers(),
      { dashboardId: DASHBOARD, shareToken: "good" },
      AT,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.fault.code).toBe("UNAUTHORIZED");
  });
});

describe("listing routes", () => {
  test("an account holding the permission in any workspace is allowed", async () => {
    const decision = await authorize(
      deps({
        session: { principal: async () => ({ account: ACCOUNT }) },
        reach: {
          workspacesFor: async () => [{ id: OTHER_WS, name: "Other", role: "member" }],
          workspaceName: async () => "Other",
        },
      }),
      { kind: "principal", permission: "workspace:read" },
      new Headers(),
      {},
      AT,
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    // The reach is computed once and handed on, so the handler does not
    // re-query what the decision already read.
    expect(decision.authority.reach).toHaveLength(1);
  });

  test("an account that belongs to nothing is refused", async () => {
    const decision = await authorize(
      deps({ session: { principal: async () => ({ account: ACCOUNT }) } }),
      { kind: "principal", permission: "workspace:read" },
      new Headers(),
      {},
      AT,
    );
    expect(decision.ok).toBe(false);
  });

  test("a member cannot list what only an admin may", async () => {
    const decision = await authorize(
      deps({
        session: { principal: async () => ({ account: ACCOUNT }) },
        reach: {
          workspacesFor: async () => [{ id: WS, name: "W", role: "member" }],
          workspaceName: async () => "W",
        },
      }),
      { kind: "principal", permission: "credentials:read" },
      new Headers(),
      {},
      AT,
    );
    expect(decision.ok).toBe(false);
  });
});

describe("resources that do not exist", () => {
  test("an unknown dashboard is a 404, not a 403", async () => {
    const decision = await authorize(
      keyed(serviceKey(["dashboards:read"], null)),
      resourceOn("dashboards:read", "dashboard", "dashboardId"),
      bearer(),
      { dashboardId: "db_nope" as DashboardId },
      AT,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.fault.code).toBe("NOT_FOUND");
    expect(decision.fault.data.reason).toBe("NoSuchDashboard");
  });
});
