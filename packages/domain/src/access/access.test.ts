import { describe, expect, test } from "bun:test";
import {
  ALL_SCOPES,
  AccountId,
  CredentialId,
  DashboardId,
  INGEST_SCOPES,
  Principal,
  ProjectId,
  ROLE_SCOPES,
  SHARE_SCOPES,
  WorkspaceId,
  decide,
  requirements,
  type Facts,
  type Placement,
  type Resource,
  type Scope,
} from "../index";

const ws = WorkspaceId("ws_1");
const otherWs = WorkspaceId("ws_2");
const prj = ProjectId("prj_1");
const otherPrj = ProjectId("prj_2");
const dash = DashboardId("dsh_1");
const account = AccountId("acc_1");

const inProject: Placement = { workspace: ws, project: prj };
const inWorkspace: Placement = { workspace: ws, project: null };

const projectResource: Resource = { type: "project", id: prj };
const dashboardResource: Resource = { type: "dashboard", id: dash };
const workspaceResource: Resource = { type: "workspace", id: ws };

const ingest: Principal = {
  kind: "ingest",
  credential: CredentialId("cred_1"),
  project: prj,
  scopes: INGEST_SCOPES,
};

const service = (over: Partial<Extract<Principal, { kind: "service" }>> = {}): Principal => ({
  kind: "service",
  credential: CredentialId("cred_2"),
  workspace: ws,
  projects: "all",
  scopes: ["queries:run", "events:read", "projects:read"],
  onBehalfOf: account,
  ...over,
});

const share: Principal = {
  kind: "share",
  credential: CredentialId("cred_3"),
  dashboard: dash,
  projects: [prj],
  scopes: SHARE_SCOPES,
};

const user: Principal = { kind: "account", account };

describe("nobody is authorized by default", () => {
  test("an anonymous principal is denied every scope on every resource", () => {
    // `anonymous` is a member of the union rather than a null principal, so a
    // route cannot forget to handle it — there is no absent case.
    for (const scope of ALL_SCOPES) {
      for (const resource of [projectResource, dashboardResource, workspaceResource]) {
        const d = decide(Principal.ANONYMOUS, scope, resource, { placement: inProject, role: "owner" });
        expect(d.allow).toBe(false);
        if (!d.allow) expect(d.denial.reason).toBe("anonymous");
      }
    }
  });

  test("even with an owner role in hand, anonymous stays denied", () => {
    // Ordering matters: identity is checked before facts, so a stray fact
    // cannot promote an unauthenticated caller.
    const d = decide(Principal.ANONYMOUS, "workspace:admin", workspaceResource, { role: "owner" });
    expect(d.allow).toBe(false);
  });
});

describe("a missing fact is an error, not an answer", () => {
  test("no placement is `unresolved`, not `denied because it does not exist`", () => {
    // The distinction matters operationally: `unresolved` means the caller
    // forgot to fetch something and is a bug in our code; `no_such_resource`
    // is a truthful 404. Collapsing them would hide the bug behind a plausible
    // user-facing error forever.
    const d = decide(user, "projects:read", projectResource, {});
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.denial).toEqual({ reason: "unresolved", fact: "placement" });
  });

  test("a resolved-but-absent placement is a real 404", () => {
    const d = decide(user, "projects:read", projectResource, { placement: null });
    if (!d.allow) expect(d.denial.reason).toBe("no_such_resource");
  });

  test("no role supplied for an account principal is `unresolved`", () => {
    const d = decide(user, "projects:read", projectResource, { placement: inProject });
    if (!d.allow) expect(d.denial).toEqual({ reason: "unresolved", fact: "role" });
  });

  test("a resolved-but-absent role means not a member", () => {
    const d = decide(user, "projects:read", projectResource, { placement: inProject, role: null });
    if (!d.allow) expect(d.denial.reason).toBe("not_a_member");
  });

  test("a missing fact never allows", () => {
    for (const scope of ALL_SCOPES) {
      expect(decide(user, scope, projectResource, {}).allow).toBe(false);
      expect(decide(ingest, scope, projectResource, {}).allow).toBe(false);
      expect(decide(service(), scope, projectResource, {}).allow).toBe(false);
    }
  });
});

describe("requirements declare exactly the facts the decision reads", () => {
  /**
   * The hazard of a pure decision function is a caller that fetches the wrong
   * facts. This test removes the need to remember: it records which fields
   * `decide` actually touches and compares them with what `requirements`
   * promised. Add a fact read without declaring it and this fails.
   */
  const recordReads = (facts: Facts): { facts: Facts; read: Set<string> } => {
    const read = new Set<string>();
    return {
      read,
      facts: new Proxy({ ...facts } as Record<string, unknown>, {
        get: (target, key) => {
          if (typeof key === "string") read.add(key);
          return target[key as string];
        },
      }) as Facts,
    };
  };

  const declared = (r: ReturnType<typeof requirements>): Set<string> =>
    new Set([...(r.placement ? ["placement"] : []), ...(r.role ? ["role"] : [])]);

  const principals: readonly Principal[] = [
    Principal.ANONYMOUS,
    user,
    ingest,
    service(),
    share,
    { kind: "worker", scopes: ["events:read"] },
  ];

  test("nothing is read that was not declared", () => {
    const full: Facts = { placement: inProject, role: "owner" };
    for (const principal of principals) {
      for (const scope of ALL_SCOPES) {
        for (const resource of [projectResource, dashboardResource, workspaceResource]) {
          const { facts, read } = recordReads(full);
          decide(principal, scope, resource, facts);
          for (const key of read) {
            expect({ principal: principal.kind, scope, key, declared: [...declared(requirements(principal))] })
              .toMatchObject({ declared: expect.arrayContaining([key]) });
          }
        }
      }
    }
  });

  test("nothing is declared that is never read — over-declaring costs a query", () => {
    const full: Facts = { placement: inProject, role: "owner" };
    for (const principal of principals) {
      const everRead = new Set<string>();
      for (const scope of ALL_SCOPES) {
        for (const resource of [projectResource, dashboardResource, workspaceResource]) {
          const { facts, read } = recordReads(full);
          decide(principal, scope, resource, facts);
          for (const k of read) everRead.add(k);
        }
      }
      expect([...everRead].sort()).toEqual([...declared(requirements(principal))].sort());
    }
  });

  test("a human needs placement and role; a key needs only placement", () => {
    expect(requirements(user)).toEqual({ placement: true, role: true });
    expect(requirements(ingest)).toEqual({ placement: true, role: false });
    expect(requirements(service())).toEqual({ placement: true, role: false });
    // A key does not inherit whatever its issuer can do today — that is the
    // whole point of issuing one. So no membership lookup, and demoting the
    // issuer does not silently change what a deployed key can do.
    expect(requirements(Principal.ANONYMOUS)).toEqual({ placement: false, role: false });
  });
});

describe("roles expand into scopes; nothing asks `is this an owner`", () => {
  test("a member may write dashboards but not touch billing or keys", () => {
    const facts: Facts = { placement: inProject, role: "member" };
    expect(decide(user, "dashboards:write", dashboardResource, facts).allow).toBe(true);
    expect(decide(user, "queries:run", projectResource, facts).allow).toBe(true);
    expect(decide(user, "billing:read", workspaceResource, facts).allow).toBe(false);
    expect(decide(user, "credentials:read", projectResource, facts).allow).toBe(false);
    expect(decide(user, "projects:delete", projectResource, facts).allow).toBe(false);
  });

  test("an admin may do everything except billing writes, deletion and workspace admin", () => {
    const facts: Facts = { placement: inProject, role: "admin" };
    expect(decide(user, "credentials:write", projectResource, facts).allow).toBe(true);
    expect(decide(user, "projects:write", projectResource, facts).allow).toBe(true);
    expect(decide(user, "billing:read", workspaceResource, facts).allow).toBe(true);
    expect(decide(user, "billing:write", workspaceResource, facts).allow).toBe(false);
    expect(decide(user, "projects:delete", projectResource, facts).allow).toBe(false);
    expect(decide(user, "workspace:admin", workspaceResource, facts).allow).toBe(false);
  });

  test("an owner may do all of it", () => {
    const facts: Facts = { placement: inProject, role: "owner" };
    for (const scope of ALL_SCOPES) {
      expect(decide(user, scope, projectResource, facts).allow).toBe(true);
    }
  });

  test("the role hierarchy is a real superset chain", () => {
    // Otherwise "promote to admin" could quietly take a permission away.
    for (const scope of ROLE_SCOPES.member) expect(ROLE_SCOPES.admin).toContain(scope);
    for (const scope of ROLE_SCOPES.admin) expect(ROLE_SCOPES.owner).toContain(scope);
    expect(ROLE_SCOPES.owner.length).toBe(ALL_SCOPES.length);
  });

  test("a denial names the role and the scope, so the message can be useful", () => {
    const d = decide(user, "billing:write", workspaceResource, { placement: inWorkspace, role: "admin" });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.denial).toEqual({ reason: "role_insufficient", role: "admin", scope: "billing:write" });
  });
});

describe("an ingest key is public, so it may do exactly one thing", () => {
  test("it writes events to the project it is bound to", () => {
    expect(decide(ingest, "events:write", projectResource, { placement: inProject }).allow).toBe(true);
  });

  test("it cannot read anything, including its own project's events", () => {
    // It ships in a browser bundle. Anyone who opens devtools has it.
    for (const scope of ALL_SCOPES) {
      if (scope === "events:write") continue;
      const d = decide(ingest, scope, projectResource, { placement: inProject });
      expect(d.allow).toBe(false);
      if (!d.allow) expect(d.denial.reason).toBe("scope_not_granted");
    }
  });

  test("it cannot write to a different project in the same workspace", () => {
    const d = decide(ingest, "events:write", { type: "project", id: otherPrj }, {
      placement: { workspace: ws, project: otherPrj },
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.denial.reason).toBe("outside_binding");
  });

  test("the scope check runs before the binding check", () => {
    // So `credentials:read` on someone else's project reports the real reason
    // (this key may never do that) rather than implying it would work on the
    // right project.
    const d = decide(ingest, "credentials:read", projectResource, { placement: { workspace: otherWs, project: otherPrj } });
    if (!d.allow) expect(d.denial.reason).toBe("scope_not_granted");
  });
});

describe("a service key is bound to a workspace, and optionally to projects", () => {
  test("an unnarrowed key acts across its workspace", () => {
    expect(decide(service(), "queries:run", projectResource, { placement: inProject }).allow).toBe(true);
  });

  test("it never crosses into another workspace", () => {
    const d = decide(service(), "queries:run", projectResource, {
      placement: { workspace: otherWs, project: otherPrj },
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.denial.reason).toBe("outside_binding");
  });

  test("a narrowed key reaches only its listed projects", () => {
    const narrowed = service({ projects: [prj] });
    expect(decide(narrowed, "queries:run", projectResource, { placement: inProject }).allow).toBe(true);
    const d = decide(narrowed, "queries:run", { type: "project", id: otherPrj }, {
      placement: { workspace: ws, project: otherPrj },
    });
    expect(d.allow).toBe(false);
  });

  test("a narrowed key still acts on workspace-level resources it has scope for", () => {
    // A workspace-level resource has no project, so the narrowing has nothing
    // to exclude it from.
    const narrowed = service({ projects: [prj], scopes: ["workspace:read"] });
    expect(decide(narrowed, "workspace:read", workspaceResource, { placement: inWorkspace }).allow).toBe(true);
  });

  test("it holds only the scopes it was issued, whatever its issuer can do", () => {
    // v1 turned any secret key into `{userId: "", role: "owner"}` — a
    // fabricated owner, with an empty user id that then landed in `created_by`.
    const d = decide(service(), "billing:write", workspaceResource, { placement: inWorkspace });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.denial.reason).toBe("scope_not_granted");
  });

  test("it names a real account for audit", () => {
    expect(Principal.actor(service())).toBe(account);
    expect(Principal.actor(user)).toBe(account);
    expect(Principal.actor(ingest)).toBeNull();
  });
});

describe("a share link is one dashboard, read-only", () => {
  test("it reads the dashboard it was issued for", () => {
    expect(decide(share, "dashboards:read", dashboardResource, { placement: inProject }).allow).toBe(true);
    expect(decide(share, "queries:run", projectResource, { placement: inProject }).allow).toBe(true);
  });

  test("it cannot read a different dashboard in the same project", () => {
    // A share link is a view of one page, not a guest account. v1's shared
    // dashboard token was a database credential handed to the browser.
    const d = decide(share, "dashboards:read", { type: "dashboard", id: DashboardId("dsh_2") }, {
      placement: inProject,
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.denial.reason).toBe("outside_binding");
  });

  test("it cannot write anything at all", () => {
    for (const scope of ALL_SCOPES) {
      if (SHARE_SCOPES.includes(scope)) continue;
      expect(decide(share, scope, dashboardResource, { placement: inProject }).allow).toBe(false);
    }
  });

  test("it cannot query another project's data", () => {
    const d = decide(share, "queries:run", { type: "project", id: otherPrj }, {
      placement: { workspace: ws, project: otherPrj },
    });
    expect(d.allow).toBe(false);
  });
});

describe("the worker is not a tenant", () => {
  test("it holds the scopes it was started with and needs no placement", () => {
    const worker: Principal = { kind: "worker", scopes: ["events:read", "monitors:read"] };
    expect(decide(worker, "events:read", projectResource, {}).allow).toBe(true);
    expect(decide(worker, "billing:write", workspaceResource, {}).allow).toBe(false);
  });
});

describe("every scope is reachable and every principal kind is handled", () => {
  test("no scope is unreachable by anyone", () => {
    // A scope no role and no key can ever hold is dead vocabulary, and dead
    // vocabulary is where a route quietly becomes unreachable.
    const reachable = new Set<Scope>([...ROLE_SCOPES.owner, ...INGEST_SCOPES, ...SHARE_SCOPES]);
    for (const scope of ALL_SCOPES) expect(reachable.has(scope)).toBe(true);
  });

  test("describe() is total and leaks nothing", () => {
    for (const p of [Principal.ANONYMOUS, user, ingest, service(), share, { kind: "worker", scopes: [] } as Principal]) {
      const text = Principal.describe(p);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain("digest");
    }
  });
});

describe("an unclaimed project is owned by nobody, not absent", () => {
  /**
   * The no-signup path depends on this. `/v1/provision` hands out an ingest
   * key that must work before anyone signs in — so the project it names has to
   * be reachable by its own credential while reachable by no membership.
   *
   * Collapsing "nobody owns it" into "no such thing" made that key answer 404,
   * which broke onboarding silently: the snippet on the first screen could not
   * send a single event, and the error read as a missing project.
   */
  const unowned: Placement = { workspace: null, project: prj };

  test("its own ingest key may write to it", () => {
    expect(decide(ingest, "events:write", projectResource, { placement: unowned })).toMatchObject({ allow: true });
  });

  test("a different project's key may not", () => {
    const elsewhere: Principal = { ...ingest, project: otherPrj };
    expect(decide(elsewhere, "events:write", projectResource, { placement: unowned })).toMatchObject({
      allow: false,
    });
  });

  test("no account reaches it, however senior", () => {
    // There is no workspace to be a member of. Adoption goes through a claim
    // grant, never through authorization — so an owner role, if one could
    // somehow be resolved, must still not grant.
    const decision = decide(
      { kind: "account", account },
      "projects:read",
      projectResource,
      { placement: unowned, role: "owner" },
    );
    expect(decision).toMatchObject({ allow: false });
  });

  test("no service key reaches it either", () => {
    expect(decide(service(), "projects:read", projectResource, { placement: unowned })).toMatchObject({
      allow: false,
    });
  });

  test("and a project that truly does not exist is still refused", () => {
    // `null` placement, not a placement with a null workspace. The two are
    // different answers and the whole fix depends on keeping them apart.
    expect(decide(ingest, "events:write", projectResource, { placement: null })).toMatchObject({ allow: false });
  });
});
