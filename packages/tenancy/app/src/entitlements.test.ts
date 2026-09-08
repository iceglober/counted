import { describe, expect, test } from "bun:test";
import { AccountId, Instant, ProjectId, WorkspaceId, isErr, isOk } from "@counted/kernel";
import type { Membership } from "@counted/identity-ports";
import { Workspace } from "@counted/tenancy-domain";
import { checkSeatAllowance, readWorkspaceUsage } from "./entitlements";
import { fakeMemberships, fakeWorkspaces } from "./testing";

const at = Instant.fromEpochMillis(1_700_000_000_000);
const ws = WorkspaceId("ws_1");
const founder = AccountId("acct_1");

const member = (i: number): Membership => ({
  account: AccountId(`acct_${i}`),
  role: "member",
  since: at,
});

const memberships = (n: number) =>
  fakeMemberships(new Map([["ws_1", Array.from({ length: n }, (_, i) => member(i))]]));

const withProjects = (...states: readonly ("active" | "archived")[]): Workspace => {
  const opened = Workspace.open(ws, "Acme", founder, at);
  if (!isOk(opened)) throw new Error("open should succeed");
  return Workspace.rehydrate({
    ...opened.value.workspace.snapshot(),
    projects: states.map((state, i) => ({ id: ProjectId(`p${i}`), name: `p${i}`, state })),
  });
};

describe("the usage readout", () => {
  test("counts projects the way the cap does: archived ones are free", async () => {
    const workspaces = fakeWorkspaces(withProjects("active", "active", "archived"));

    const usage = await readWorkspaceUsage(
      { workspaces, memberships: memberships(4) },
      { workspace: ws, eventsUsed: 12_345 },
    );

    if (!isOk(usage)) throw new Error("usage should read");
    expect(usage.value.projects).toEqual({ used: 2, limit: 3 });
    expect(usage.value.seats).toEqual({ used: 4, limit: null });
    expect(usage.value.events).toEqual({ used: 12_345, limit: 100_000, state: "ok" });
    expect(usage.value.plan).toBe("free");
    expect(usage.value.inGrace).toBe(false);
  });

  test("names the overage band rather than reporting it as fine", async () => {
    const workspaces = fakeWorkspaces(withProjects());
    const usage = await readWorkspaceUsage(
      { workspaces, memberships: memberships(1) },
      { workspace: ws, eventsUsed: 110_000 },
    );
    if (!isOk(usage)) throw new Error("usage should read");
    expect(usage.value.events.state).toBe("overage");
  });

  test("says rejected once ingestion has actually stopped", async () => {
    const workspaces = fakeWorkspaces(withProjects());
    const usage = await readWorkspaceUsage(
      { workspaces, memberships: memberships(1) },
      { workspace: ws, eventsUsed: 200_000 },
    );
    if (!isOk(usage)) throw new Error("usage should read");
    expect(usage.value.events.state).toBe("rejected");
  });

  test("an unknown workspace is refused, not reported as empty usage", async () => {
    const usage = await readWorkspaceUsage(
      { workspaces: fakeWorkspaces(), memberships: memberships(0) },
      { workspace: ws, eventsUsed: 0 },
    );
    if (!isErr(usage)) throw new Error("an unknown workspace should be refused");
    expect(usage.error).toEqual({ kind: "NoSuchWorkspace", workspace: ws });
  });
});

describe("seats", () => {
  test("no published plan caps seats, so nobody is refused for being the eleventh", async () => {
    const workspaces = fakeWorkspaces(withProjects());
    const allowance = await checkSeatAllowance(
      { workspaces, memberships: memberships(50) },
      ws,
    );
    if (!isOk(allowance)) throw new Error("seats are uncapped today");
    expect(allowance.value).toEqual({ used: 50, limit: null });
  });

  test("an unknown workspace is refused", async () => {
    const allowance = await checkSeatAllowance(
      { workspaces: fakeWorkspaces(), memberships: memberships(0) },
      ws,
    );
    expect(isErr(allowance)).toBe(true);
  });
});
