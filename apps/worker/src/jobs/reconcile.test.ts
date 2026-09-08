import { describe, expect, test } from "bun:test";

import { AccountId, Duration, WorkspaceId, type AccountId as Account } from "@counted/kernel";
import { Subscription, Workspace, type WorkspaceEvent } from "@counted/tenancy-domain";
import type { ProvisionWorkspaceDeps, WorkspaceRepository } from "@counted/tenancy-app";
import type { SubscriptionRepository } from "@counted/tenancy-app";
import type { UnitOfWork } from "@counted/persistence-ports";

import { reconcileWorkspaces } from "./reconcile";
import { recordingLogger } from "../logging";
import type { OrganizationDirectory, OrganizationRecord } from "../ports";
import { T0 } from "../testing";

class FakeWorkspaces implements WorkspaceRepository {
  readonly rows = new Map<string, Workspace>();
  readonly saved: Workspace[] = [];

  async find(id: WorkspaceId): Promise<Workspace | null> {
    return this.rows.get(String(id)) ?? null;
  }
  async listForAccount(): Promise<readonly never[]> {
    return [];
  }
  async save(workspace: Workspace, _events: readonly WorkspaceEvent[]): Promise<void> {
    this.rows.set(String(workspace.id), workspace);
    this.saved.push(workspace);
  }
}

class FakeSubscriptions implements SubscriptionRepository {
  readonly saved: Subscription[] = [];
  async find(): Promise<Subscription | null> {
    return null;
  }
  async findByCustomer(): Promise<Subscription | null> {
    return null;
  }
  async findBySubscriptionRef(): Promise<Subscription | null> {
    return null;
  }
  async save(subscription: Subscription): Promise<void> {
    this.saved.push(subscription);
  }
}

const OWNER: Account = AccountId("acc_1");

const orphan = (overrides: Partial<OrganizationRecord> = {}): OrganizationRecord => ({
  workspace: WorkspaceId("ws_orphan"),
  name: "Acme",
  owner: OWNER,
  createdAt: T0,
  ...overrides,
});

const directoryOf = (records: readonly OrganizationRecord[]): OrganizationDirectory => ({
  page: async () => ({ items: records, cursor: null }),
});

const world = () => {
  const workspaces = new FakeWorkspaces();
  const subscriptions = new FakeSubscriptions();
  const repositories: ProvisionWorkspaceDeps = { workspaces, subscriptions };
  let transactions = 0;
  const uow: UnitOfWork<ProvisionWorkspaceDeps> = {
    transact: async (work) => {
      transactions += 1;
      return await work(repositories);
    },
  };
  return { workspaces, subscriptions, uow, transactions: () => transactions };
};

const deps = (
  organizations: OrganizationDirectory | null,
  w: ReturnType<typeof world>,
  repair = true,
) => ({
  organizations,
  workspaces: w.workspaces,
  uow: w.uow,
  logger: recordingLogger(),
  lookback: Duration.days(30),
  batch: 100,
  repair,
});

describe("reconciling the two halves of a workspace", () => {
  test("walks every page so a full first batch cannot starve later orphans", async () => {
    const w = world();
    const first = orphan({ workspace: WorkspaceId("ws_a") });
    const second = orphan({ workspace: WorkspaceId("ws_b") });
    const calls: string[] = [];
    const organizations: OrganizationDirectory = {
      page: async ({ cursor, limit }) => {
        expect(limit).toBe(1);
        calls.push(cursor?.workspace ?? "first");
        return cursor === null
          ? { items: [first], cursor: { workspace: first.workspace, createdAt: first.createdAt } }
          : { items: [second], cursor: null };
      },
    };
    const report = await reconcileWorkspaces({ ...deps(organizations, w), batch: 1 }, T0);
    expect(report).toMatchObject({ scanned: 2, orphans: 2, repaired: 2 });
    expect(calls).toEqual(["first", "ws_a"]);
    expect(w.subscriptions.saved).toHaveLength(2);
  });

  test("with no way to read organizations it says so rather than reporting everything consistent", async () => {
    const report = await reconcileWorkspaces(deps(null, world()), T0);

    expect(report.kind).toBe("unavailable");
    if (report.kind !== "unavailable") throw new Error("unreachable");
    expect(report.missing).toContain("OrganizationDirectory");
  });

  test("an organization with a workspace is not an orphan", async () => {
    const w = world();
    const opened = Workspace.open(WorkspaceId("ws_orphan"), "Acme", OWNER, T0);
    if (!opened.ok) throw new Error("bad fixture");
    await w.workspaces.save(opened.value.workspace, opened.value.events);
    w.workspaces.saved.length = 0;

    const report = await reconcileWorkspaces(deps(directoryOf([orphan()]), w), T0);

    expect(report).toMatchObject({ kind: "checked", scanned: 1, orphans: 0, repaired: 0 });
    expect(w.workspaces.saved).toHaveLength(0);
  });

  /**
   * The repair writes the workspace *and* its free-plan subscription row,
   * because that is what `provisionWorkspace` does. Writing only the first
   * reproduces v1's failure exactly: the first Stripe webhook has nothing to
   * update, matches no rows, reports success, and the customer pays for
   * nothing.
   */
  test("an orphan is repaired through the same use case the create path runs", async () => {
    const w = world();

    const report = await reconcileWorkspaces(deps(directoryOf([orphan()]), w), T0);

    expect(report).toMatchObject({ scanned: 1, orphans: 1, repaired: 1, unrepairable: 0 });
    expect(w.workspaces.saved).toHaveLength(1);
    expect(w.subscriptions.saved).toHaveLength(1);
    expect(w.transactions()).toBe(1);
  });

  test("an organization with no owner is reported and never repaired", async () => {
    const w = world();
    const logger = recordingLogger();

    const report = await reconcileWorkspaces(
      { ...deps(directoryOf([orphan({ owner: null })]), w), logger },
      T0,
    );

    expect(report).toMatchObject({ orphans: 1, repaired: 0, unrepairable: 1 });
    expect(w.workspaces.saved).toHaveLength(0);
    expect(logger.lines.find((l) => l.event === "reconcile.unrepairable")?.fields["detail"]).toContain(
      "no owner member",
    );
  });

  test("with repair off it finds and reports and writes nothing", async () => {
    const w = world();
    const logger = recordingLogger();

    const report = await reconcileWorkspaces(
      { ...deps(directoryOf([orphan()]), w, false), logger },
      T0,
    );

    expect(report).toMatchObject({ orphans: 1, repaired: 0, unrepairable: 1 });
    expect(w.workspaces.saved).toHaveLength(0);
    expect(logger.lines.find((l) => l.event === "reconcile.orphan")?.fields["repair"]).toBe(false);
  });

  /**
   * Two workers reconciling at once. The read inside the transaction runs under
   * the row lock the transactional repository takes, so the loser finds the
   * workspace already there — and must not count it as an orphan it repaired.
   */
  test("a workspace another worker created between the two reads is not counted", async () => {
    const w = world();
    const uow: UnitOfWork<ProvisionWorkspaceDeps> = {
      transact: async (work) => {
        const opened = Workspace.open(WorkspaceId("ws_orphan"), "Acme", OWNER, T0);
        if (!opened.ok) throw new Error("bad fixture");
        await w.workspaces.save(opened.value.workspace, opened.value.events);
        w.workspaces.saved.length = 0;
        return await work({ workspaces: w.workspaces, subscriptions: w.subscriptions });
      },
    };

    const report = await reconcileWorkspaces(
      { ...deps(directoryOf([orphan()]), w), uow },
      T0,
    );

    expect(report).toMatchObject({ scanned: 1, orphans: 0, repaired: 0, unrepairable: 0 });
    expect(w.subscriptions.saved).toHaveLength(0);
  });

  test("one failing organization does not end the pass", async () => {
    const w = world();
    let calls = 0;
    const workspaces = {
      ...w.workspaces,
      find: async (id: WorkspaceId) => {
        calls += 1;
        if (calls === 1) throw new Error("connection reset");
        return w.workspaces.find(id);
      },
      listForAccount: w.workspaces.listForAccount.bind(w.workspaces),
      save: w.workspaces.save.bind(w.workspaces),
    } as WorkspaceRepository;

    const report = await reconcileWorkspaces(
      {
        ...deps(directoryOf([orphan({ workspace: WorkspaceId("ws_a") }), orphan({ workspace: WorkspaceId("ws_b") })]), w),
        workspaces,
      },
      T0,
    );

    expect(report).toMatchObject({ scanned: 2, failures: 1, orphans: 1, repaired: 1 });
  });
});
