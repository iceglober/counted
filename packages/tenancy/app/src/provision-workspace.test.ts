import { describe, expect, test } from "bun:test";
import { AccountId, Instant, WorkspaceId, isErr, isOk } from "@counted/kernel";
import { provisionWorkspace } from "./provision-workspace";
import { fakeSubscriptions, fakeWorkspaces } from "./testing";

const at = Instant.fromEpochMillis(1_700_000_000_000);
const ws = WorkspaceId("ws_1");
const founder = AccountId("acct_1");

describe("provisioning", () => {
  test("writes the workspace and a free-plan subscription row", async () => {
    const workspaces = fakeWorkspaces();
    const subscriptions = fakeSubscriptions();

    const result = await provisionWorkspace(
      { workspaces, subscriptions },
      { workspace: ws, name: "Acme", founder },
      at,
    );

    if (!isOk(result)) throw new Error("provisioning should succeed");
    expect(result.value.workspace.plan).toBe("free");
    expect(await workspaces.find(ws)).not.toBeNull();

    // The row exists before any payment does. Without it the first webhook has
    // nothing to upsert onto, which is v1's silent upgrade-to-nothing.
    const subscription = await subscriptions.find(ws);
    expect(subscription).not.toBeNull();
    expect(subscription?.payment).toBe("none");
    expect(subscription?.customer).toBeNull();
  });

  test("the opening event carries the founder, and rides the same save", async () => {
    const workspaces = fakeWorkspaces();
    await provisionWorkspace(
      { workspaces, subscriptions: fakeSubscriptions() },
      { workspace: ws, name: "Acme", founder },
      at,
    );
    expect(workspaces.events).toEqual([{ kind: "WorkspaceOpened", workspace: ws, founder, at }]);
    expect(workspaces.saves).toBe(1);
  });

  test("a refused name writes nothing at all", async () => {
    const workspaces = fakeWorkspaces();
    const subscriptions = fakeSubscriptions();

    const result = await provisionWorkspace(
      { workspaces, subscriptions },
      { workspace: ws, name: "  ", founder },
      at,
    );

    expect(isErr(result)).toBe(true);
    expect(workspaces.saves).toBe(0);
    expect(subscriptions.saves).toBe(0);
  });
});
