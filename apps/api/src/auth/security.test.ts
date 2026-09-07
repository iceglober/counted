/**
 * One declaration, two outputs — and this is the test that they agree.
 *
 * `@counted/contract` states each procedure's requirement once. That value
 * produces the OpenAPI `security` block, through `securityFor`, and it
 * produces the runtime refusal, through `authorize` reading it back with
 * `requirementFor(path)`. Nothing before this file compared the two ends.
 *
 * v2 shipped exactly that gap: security was written twice — an oRPC middleware
 * decided access, a hand-maintained document said which schemes an operation
 * took — and `/v1/workspaces/{id}/credentials` was documented as session-only
 * for four months while a service key had been able to call it since the day it
 * shipped. Nothing was wrong with either half; there was simply no test that
 * read both.
 *
 * The two directions, per procedure:
 *
 *   **The permission.** A caller carrying everything EXCEPT the declared
 *   permission must be refused, and the refusal must name that permission —
 *   which proves the guard enforces at least what the document claims. A
 *   caller carrying ONLY the declared permission must be allowed — which
 *   proves it enforces no more. Together they pin the enforced permission to
 *   the declared one, from both sides.
 *
 *   **The scheme.** For each of the four credentials Counted issues, the best
 *   case of that kind is allowed if and only if the document's `security`
 *   block offers it. A scheme in the block that the route refuses is v2's bug
 *   with the sign flipped; a scheme the route accepts and the block omits is a
 *   caller who reads the spec and does not try.
 *
 * The permissions handed to the fabricated service key are deliberately not
 * restricted to what is issuable: `@counted/projects-domain`'s ceiling keeps
 * `workspace:admin` off a real key, and it is not this test's business — the
 * guard's job is to enforce the declaration, and `grants.test.ts` is where the
 * ceiling is checked.
 */

import { describe, expect, test } from "bun:test";
import { implement } from "@orpc/server";
import {
  ALL_PERMISSIONS,
  Instant,
  type AccountId,
  type CredentialId,
  type DashboardId,
  type MonitorId,
  type Permission,
  type ProjectId,
  type WorkspaceId,
} from "@counted/kernel";
import {
  contract,
  permissionOf,
  requirements,
  securityFor,
  SECURITY_SCHEMES,
  INGESTION_PATHS,
  type AuthorizationRequirement,
  type ResourceType,
  type SecurityScheme,
} from "@counted/contract";
import type { VerifiedCredential } from "@counted/identity-ports";
import { authorize, type AuthorizeDeps } from "./authorize";
import type { PlacementReader } from "./placement";
import { authorizeDeps } from "../index";
import { createRouter } from "../router";
import { testDependencies } from "../testing";

const AT = Instant.fromEpochMillis(1_700_000_000_000);
const WS = "ws_1" as WorkspaceId;
const PROJECT = "pr_1" as ProjectId;
const DASHBOARD = "db_1" as DashboardId;
const MONITOR = "mn_1" as MonitorId;
const ACCOUNT = "acct_1" as AccountId;
const SHARE_TOKEN = "share-token";

/** Every resource this world contains, all of it inside `WS`. */
const placements: PlacementReader = {
  workspaceExists: async (workspace) => workspace === WS,
  projectPlacement: async (project) => (project === PROJECT ? { workspace: WS } : undefined),
  dashboardWorkspace: async (dashboard) => (dashboard === DASHBOARD ? WS : undefined),
  monitorPlacement: async (monitor) =>
    monitor === MONITOR ? { workspace: WS, project: PROJECT } : undefined,
};

const idFor = (resource: ResourceType): string => {
  switch (resource) {
    case "workspace":
      return WS;
    case "project":
      return PROJECT;
    case "dashboard":
      return DASHBOARD;
    case "monitor":
      return MONITOR;
    case "credential":
      // No route authorizes against a credential, and `locate` answers 500 if
      // one ever does. Reaching this is the test noticing before a caller does.
      return "cred_1";
  }
};

const unusedStore = {
  issue: async () => { throw new Error("unused"); },
  rotate: async () => { throw new Error("unused"); },
  revoke: async () => { throw new Error("unused"); },
  list: async () => [],
  reassignProject: async () => 0,
} as const;

const base = (): AuthorizeDeps => ({
  placements,
  credentials: { verify: async () => ({ ok: false, error: { kind: "Unknown" } }), ...unusedStore },
  // An owner everywhere: a console session is being measured on its role, and
  // the highest one is the best case for "could this scheme ever work".
  memberships: { roleOf: async () => "owner", membersOf: async () => [] },
  session: { principal: async () => null },
  share: { resolve: async () => null },
  reach: { workspacesFor: async () => [{ id: WS, name: "W", role: "owner" }], workspaceName: async () => "W" },
  projectWorkspace: async () => WS,
});

const withKey = (credential: VerifiedCredential): AuthorizeDeps => ({
  ...base(),
  credentials: {
    verify: async (secret) =>
      secret === "key" ? { ok: true, value: credential } : { ok: false, error: { kind: "Unknown" } },
    ...unusedStore,
  },
});

const serviceKey = (permissions: readonly Permission[]): VerifiedCredential => ({
  id: "cred_service" as CredentialId,
  kind: "service",
  workspace: WS,
  // Unnarrowed, so the binding reaches everything in the workspace and what is
  // measured is the permission rather than the placement.
  project: null,
  permissions,
  issuedBy: ACCOUNT,
});

const ingestKey = (): VerifiedCredential => ({
  id: "cred_ingest" as CredentialId,
  kind: "ingest",
  workspace: WS,
  project: PROJECT,
  permissions: ["events:write"],
  issuedBy: ACCOUNT,
});

const bearer = new Headers({ authorization: "Bearer key" });

/** The request body the guard reads: the id its requirement names, and nothing else. */
const inputFor = (requirement: AuthorizationRequirement, shareToken: boolean): unknown => ({
  ...(requirement.kind === "resource" ? { [requirement.param]: idFor(requirement.resource) } : {}),
  ...(shareToken ? { shareToken: SHARE_TOKEN } : {}),
});

/** The best case for one credential kind: the most that kind can ever be. */
const attempt = async (
  requirement: AuthorizationRequirement,
  scheme: SecurityScheme,
): Promise<boolean> => {
  switch (scheme) {
    case "ingestBeacon":
      // Query keys belong to the dedicated ingest transport. The oRPC guard
      // sees no bearer/session authority from a query key.
      return (await authorize(base(), requirement, new Headers(), inputFor(requirement, false), AT)).ok;
    case "consoleSession": {
      const deps = { ...base(), session: { principal: async () => ({ account: ACCOUNT }) } };
      return (await authorize(deps, requirement, new Headers(), inputFor(requirement, false), AT)).ok;
    }
    case "serviceKey": {
      const deps = withKey(serviceKey(ALL_PERMISSIONS));
      return (await authorize(deps, requirement, bearer, inputFor(requirement, false), AT)).ok;
    }
    case "ingestKey": {
      const deps = withKey(ingestKey());
      return (await authorize(deps, requirement, bearer, inputFor(requirement, false), AT)).ok;
    }
    case "shareToken": {
      const deps: AuthorizeDeps = {
        ...base(),
        share: {
          resolve: async (token) =>
            token === SHARE_TOKEN
              ? {
                  credential: "cred_share" as CredentialId,
                  dashboard: DASHBOARD,
                  projects: [PROJECT],
                }
              : null,
        },
      };
      return (await authorize(deps, requirement, new Headers(), inputFor(requirement, true), AT)).ok;
    }
  }
};

/** Every procedure in the contract tree, addressed the way the registry is. */
const procedureIds = (node: unknown, prefix: readonly string[] = []): string[] => {
  if (typeof node !== "object" || node === null) return [];
  if ("~orpc" in node) return [prefix.join(".")];
  return Object.entries(node).flatMap(([key, value]) => procedureIds(value, [...prefix, key]));
};

const IDS = procedureIds(contract).sort();

/** The declaration for a procedure, or a loud failure. Never a default. */
const requirementOf = (id: string): AuthorizationRequirement => {
  const requirement = requirements.get(id);
  if (requirement === undefined) {
    throw new Error(`${id} declares no authorization requirement`);
  }
  return requirement;
};

describe("every procedure declares a requirement, and every requirement has a procedure", () => {
  test("the two sets are equal, so nothing below this is testing a subset", () => {
    // The entry condition for everything else in this file. A procedure with
    // no declaration would otherwise be skipped by the loops rather than
    // failing them — and at runtime it answers 500, which is the honest
    // response to a route whose access rule nobody wrote.
    expect([...requirements.keys()].sort()).toEqual(IDS);
    expect(IDS.length).toBeGreaterThan(40);
  });

  test("every permission a requirement names is in the vocabulary", () => {
    for (const id of IDS) {
      const permission = permissionOf(requirementOf(id));
      if (permission === null) continue;
      expect(ALL_PERMISSIONS, id).toContain(permission);
    }
  });
});

describe("the permission the guard enforces is the permission the contract declares", () => {
  for (const id of IDS) {
    const requirement = requirementOf(id);
    const permission = permissionOf(requirement);
    if (permission === null) continue;

    test(`${id} refuses a caller missing ${permission}, and says which`, async () => {
      const others = ALL_PERMISSIONS.filter((p) => p !== permission);
      const decision = await authorize(
        withKey(serviceKey(others)),
        requirement,
        bearer,
        inputFor(requirement, false),
        AT,
      );
      expect(decision.ok, id).toBe(false);
      if (decision.ok) return;
      // Not merely "refused": refused FOR THIS PERMISSION. A guard enforcing
      // some other permission would also refuse here, and would pass a test
      // that only checked the boolean.
      expect(decision.denial, id).toEqual({ reason: "NotPermitted", required: permission });
    });

    test(`${id} accepts a caller carrying only ${permission}`, async () => {
      const decision = await authorize(
        withKey(serviceKey([permission])),
        requirement,
        bearer,
        inputFor(requirement, false),
        AT,
      );
      expect(decision.ok, id).toBe(true);
    });
  }
});

describe("the schemes the document offers are the schemes the route accepts", () => {
  for (const id of IDS) {
    const requirement = requirementOf(id);
    // `security: []` says "this operation takes no credential", which is not
    // "this operation refuses every credential" — provisioning still resolves
    // whoever called it, so the audit line names them. The one route shaped
    // this way is tested on its own below.
    if (requirement.kind === "anonymous") continue;

    const offered = new Set(
      securityFor(requirement).flatMap((alternative) => Object.keys(alternative)),
    );

    for (const scheme of SECURITY_SCHEMES) {
      test(`${id} ${offered.has(scheme) ? "accepts" : "refuses"} ${scheme}`, async () => {
        expect(await attempt(requirement, scheme), `${id} / ${scheme}`).toBe(offered.has(scheme));
      });
    }
  }

  test("the scheme vocabulary has no member no route offers", () => {
    // A scheme nothing accepts is a credential the document tells callers to
    // present and the server has no code path for.
    const used = new Set<SecurityScheme>();
    for (const alternative of INGESTION_PATHS["/v1/events"].post.security) {
      for (const scheme of Object.keys(alternative)) used.add(scheme as SecurityScheme);
    }
    for (const id of IDS) {
      for (const alternative of securityFor(requirementOf(id))) {
        for (const scheme of Object.keys(alternative)) used.add(scheme as SecurityScheme);
      }
    }
    expect([...used].sort()).toEqual([...SECURITY_SCHEMES].sort());
  });

  test("the one route with an empty security block takes any caller, and none", async () => {
    const open = IDS.filter((id) => securityFor(requirementOf(id)).length === 0);
    expect(open).toEqual(["projects.provision"]);

    const requirement = requirementOf("projects.provision");
    for (const scheme of SECURITY_SCHEMES) {
      expect(await attempt(requirement, scheme), scheme).toBe(true);
    }
    expect((await authorize(base(), requirement, new Headers(), {}, AT)).ok).toBe(true);
  });
});

/**
 * The seam between this file and the server: `authorize` decides, but only for
 * procedures that actually run behind it.
 *
 * A handler built from the plain implementer instead of the guarded one is
 * three characters different in the source and skips authorization entirely —
 * and every test above would still pass, because they call `authorize`
 * directly. oRPC records a procedure's middleware chain, so the guard is
 * visible on the built procedure: one for a guarded procedure, none for a bare
 * one. The bare procedure is built here rather than described in a comment,
 * because an assertion that cannot fail is not an assertion.
 */
describe("every mounted procedure runs behind the guard", () => {
  const chainOf = (procedure: unknown): number =>
    ((procedure as { "~orpc": { orderedMiddlewares?: readonly unknown[] } })["~orpc"]
      .orderedMiddlewares ?? []).length;

  const walk = (node: unknown, prefix: readonly string[] = []): [string, unknown][] => {
    if (typeof node !== "object" || node === null) return [];
    if ("~orpc" in node) return [[prefix.join("."), node]];
    return Object.entries(node).flatMap(([key, value]) => walk(value, [...prefix, key]));
  };

  test("a procedure built off the plain implementer has no middleware at all", () => {
    const bare = implement(contract)
      .$context<never>()
      .account.me.handler(async () => ({}) as never);
    expect(chainOf(bare)).toBe(0);
  });

  test("every procedure the router mounts carries the authorization middleware", () => {
    const deps = testDependencies();
    const mounted = walk(createRouter(deps, authorizeDeps(deps)));
    expect(mounted.length).toBe(IDS.length);
    for (const [id, procedure] of mounted) {
      expect(chainOf(procedure), id).toBe(1);
    }
  });
});
