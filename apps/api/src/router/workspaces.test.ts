/**
 * Membership writes, through the whole stack, over a fake writer.
 *
 * The rules — the last owner stays, a change must change something — live
 * behind `MembershipWriter` and are proven by its contract suite. What is
 * under test here is the router's share of the decision: that authorization
 * still gates the route (`workspace:admin` is owners-only, so an admin is
 * refused before the port is reached), that an account which does not exist
 * is refused before anything is written, and that a refusal from the port
 * arrives on the wire at the contract's status with the contract's reason.
 */

import { describe, expect, test } from "bun:test";
import { Instant, err, ok, type AccountId, type Role, type WorkspaceId } from "@counted/kernel";
import type {
  Account,
  ChangeRoleFailure,
  MembershipDirectory,
  MembershipWriter,
  RemoveMemberFailure,
} from "@counted/identity-ports";
import { Workspace } from "@counted/tenancy-domain";
import type { ApiDependencies } from "../deps";
import { authorizeDeps } from "../index";
import { createServer } from "../server";
import { countingIds, fixedGeo, frozenClock, testDependencies } from "../testing";

const AT = Instant.fromEpochMillis(1_700_000_000_000);
const WS = "ws_1" as WorkspaceId;
const CALLER = "acct_caller" as AccountId;
const TARGET = "acct_target" as AccountId;

const workspace = (): Workspace => {
  const opened = Workspace.open(WS, "Acme", CALLER, AT);
  if (!opened.ok) throw new Error("unreachable: a named workspace opens");
  return opened.value.workspace;
};

const person = (id: AccountId): Account => ({
  id,
  email: `${id}@example.com`,
  name: null,
  emailVerified: true,
  createdAt: AT,
});

type Write = {
  readonly method: "changeRole" | "remove";
  readonly workspace: WorkspaceId;
  readonly account: AccountId;
  readonly role?: Role;
};

type World = {
  /** The caller's role in the workspace; null for a stranger. */
  readonly caller: Role | null;
  /** Accounts that exist. Defaults to the caller and the target. */
  readonly accounts?: readonly AccountId[];
  /** What the writer refuses with, if anything. */
  readonly refuseChange?: ChangeRoleFailure;
  readonly refuseRemove?: RemoveMemberFailure;
};

const build = (world: World) => {
  const writes: Write[] = [];
  const known = new Set<AccountId>(world.accounts ?? [CALLER, TARGET]);

  const memberships: MembershipDirectory & MembershipWriter = {
    roleOf: async (_account, id) => (id === WS ? world.caller : null),
    membersOf: async () => [],
    changeRole: async (ws, account, role) => {
      writes.push({ method: "changeRole", workspace: ws, account, role });
      return world.refuseChange === undefined
        ? ok({ account, role, since: AT })
        : err(world.refuseChange);
    },
    remove: async (ws, account) => {
      writes.push({ method: "remove", workspace: ws, account });
      return world.refuseRemove === undefined
        ? ok({ account, role: "member", since: AT })
        : err(world.refuseRemove);
    },
  };

  const deps: ApiDependencies = testDependencies({
    clock: frozenClock(AT),
    ids: countingIds("trace"),
    reads: {
      ...testDependencies().reads,
      workspaces: {
        find: async (id) => (id === WS ? workspace() : null),
        listForAccount: async () => [],
        save: async () => {},
      },
    } as ApiDependencies["reads"],
    identity: {
      ...testDependencies().identity,
      accounts: {
        find: async (id) => (known.has(id) ? person(id) : null),
        findByEmail: async () => null,
        findMany: async () => new Map(),
      },
      memberships,
      http: {
        handle: async () => new Response(null, { status: 404 }),
        oauthPrincipal: async () => null,
        principal: async (headers) =>
          headers.get("cookie") === "session=good"
            ? {
                account: CALLER,
                email: "caller@example.com",
                emailVerified: true,
                activeWorkspace: WS,
                expiresAt: AT,
              }
            : null,
      },
    } as ApiDependencies["identity"],
  });

  const app = createServer({
    deps,
    authorize: authorizeDeps(deps),
    ingest: {
      credentials: deps.identity.credentials,
      commit: {
        submit: async () => ({ kind: "Committed", accepted: 0, deduplicated: 0, rejected: [], commit: null }),
      } as never,
      projectWorkspace: async () => WS,
      logger: deps.logger,
      maxBodyBytes: 1000,
      geo: fixedGeo(),
      trustedProxyHops: 1,
    },
    webhook: null,
    mintTraceId: () => "trace-fixed",
  });

  const signedIn = { cookie: "session=good" };
  return {
    writes,
    leave: (headers: Record<string, string> = signedIn) => app.request(`http://api.test/v1/workspaces/${WS}/leave`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" }),
    changeRole: (role: string, headers: Record<string, string> = signedIn) =>
      app.request(`http://api.test/v1/workspaces/${WS}/members/${TARGET}/role`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    removeMember: (headers: Record<string, string> = signedIn) =>
      app.request(`http://api.test/v1/workspaces/${WS}/members/${TARGET}`, {
        method: "DELETE",
        headers,
      }),
  };
};

describe("workspaces.changeRole", () => {
  test("an owner changes a member's role and reads the membership back", async () => {
    const api = build({ caller: "owner" });
    const response = await api.changeRole("admin");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      member: {
        account: {
          id: TARGET,
          email: `${TARGET}@example.com`,
          name: null,
          emailVerified: true,
          createdAt: Instant.toISO(AT),
        },
        role: "admin",
        since: Instant.toISO(AT),
      },
    });
    expect(api.writes).toEqual([{ method: "changeRole", workspace: WS, account: TARGET, role: "admin" }]);
  });

  test("an admin is refused before the port is reached", async () => {
    const api = build({ caller: "admin" });
    const response = await api.changeRole("member");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ data: { reason: "NotPermitted" } });
    expect(api.writes).toEqual([]);
  });

  test("no credential is a 401, and nothing is written", async () => {
    const api = build({ caller: "owner" });
    expect((await api.changeRole("admin", {})).status).toBe(401);
    expect(api.writes).toEqual([]);
  });

  test("an account that does not exist is not a member, and nothing is written", async () => {
    const api = build({ caller: "owner", accounts: [CALLER] });
    const response = await api.changeRole("admin");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ data: { reason: "NotAMember", account: TARGET } });
    expect(api.writes).toEqual([]);
  });

  const refusals: readonly { readonly failure: ChangeRoleFailure; readonly status: number }[] = [
    { failure: { kind: "LastOwner", account: TARGET }, status: 409 },
    { failure: { kind: "RoleUnchanged", account: TARGET, role: "admin" }, status: 409 },
    { failure: { kind: "NotAMember", account: TARGET }, status: 404 },
  ];
  for (const { failure, status } of refusals) {
    test(`the port's ${failure.kind} arrives as a ${status} with that reason`, async () => {
      const api = build({ caller: "owner", refuseChange: failure });
      const response = await api.changeRole("admin");
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ data: { reason: failure.kind, account: TARGET } });
    });
  }

  test("a role outside the vocabulary never reaches the port", async () => {
    const api = build({ caller: "owner" });
    const response = await api.changeRole("superuser");
    expect(response.status).toBe(400);
    expect(api.writes).toEqual([]);
  });
});

describe("workspaces.removeMember", () => {
  test("an owner removes a member", async () => {
    const api = build({ caller: "owner" });
    const response = await api.removeMember();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: true, account: TARGET });
    expect(api.writes).toEqual([{ method: "remove", workspace: WS, account: TARGET }]);
  });

  test("the last owner cannot be removed", async () => {
    const api = build({ caller: "owner", refuseRemove: { kind: "LastOwner", account: TARGET } });
    const response = await api.removeMember();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ data: { reason: "LastOwner", account: TARGET } });
  });

  test("a non-member is a 404", async () => {
    const api = build({ caller: "owner", refuseRemove: { kind: "NotAMember", account: TARGET } });
    expect((await api.removeMember()).status).toBe(404);
  });

  test("an admin is refused before the port is reached", async () => {
    const api = build({ caller: "admin" });
    expect((await api.removeMember()).status).toBe(403);
    expect(api.writes).toEqual([]);
  });
});

describe("workspaces.leave", () => {
  test("a member can remove only their own membership", async () => {
    const api = build({ caller: "member" });
    expect((await api.leave()).status).toBe(200);
    expect(api.writes).toEqual([{ method: "remove", workspace: WS, account: CALLER }]);
  });
  test("the last owner must transfer ownership first", async () => {
    const api = build({ caller: "owner", refuseRemove: { kind: "LastOwner", account: CALLER } });
    const response = await api.leave();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ data: { reason: "LastOwner", account: CALLER } });
  });
  test("a signed-out person cannot leave a workspace", async () => {
    const api = build({ caller: "member" });
    expect((await api.leave({})).status).toBe(401);
    expect(api.writes).toEqual([]);
  });
});
