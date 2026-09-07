/**
 * The transaction boundary, and the two things it exists to make true.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";
import { ProjectId, WorkspaceId, err, type EventEnvelope } from "@counted/kernel";
import { Project } from "@counted/projects-domain";
import { Workspace } from "@counted/tenancy-domain";
import { T0, anAccount, givenWorkspace, liveHarness, must, type Harness } from "./fixtures";
import { closeDatabase, describeLive } from "./testing";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const envelope = (id: string): EventEnvelope => ({
  id,
  type: "tenancy.WorkspaceOpened",
  occurredAt: T0,
  payload: { kind: "WorkspaceOpened", at: T0 },
});

describeLive("postgresUnitOfWork", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await liveHarness();
    await h.reset();
  });
  afterAll(closeDatabase);

  test("both aggregates land, or neither does", async () => {
    // Creating a project is two aggregates: the workspace agrees the project may
    // exist and takes the slot, and the project is created. Neither package may
    // import the other, so the composition root calls both inside one transact.
    const workspace = await givenWorkspace(h.repositories);

    await h.unitOfWork.transact(async (repositories) => {
      const loaded = await repositories.workspaces.find(workspace);
      const reserved = must(loaded!.registerProject(ProjectId("prj_1"), "Web", T0));
      await repositories.workspaces.save(reserved.workspace, reserved.events);

      const created = must(Project.create(ProjectId("prj_1"), "Web", workspace, T0));
      await repositories.projects.save(created.project, created.events);
      await repositories.outbox.enqueue([envelope("e1")]);
    });

    expect((await h.repositories.workspaces.find(workspace))?.projectCount).toBe(1);
    expect(await h.repositories.outbox.pendingCount()).toBe(1);
  });

  test("a throw rolls back everything the transaction wrote", async () => {
    // v1 had no such boundary, which is why project deletion ran its
    // `DELETE FROM events` on the pool while a transaction was open on another
    // connection — the rollback that was supposed to protect it rolled back
    // nothing.
    const workspace = await givenWorkspace(h.repositories);

    await expect(
      h.unitOfWork.transact(async (repositories) => {
        const created = must(Project.create(ProjectId("prj_1"), "Web", workspace, T0));
        await repositories.projects.save(created.project, created.events);
        await repositories.outbox.enqueue([envelope("e1")]);
        throw new Error("the second half failed");
      }),
    ).rejects.toThrow("the second half failed");

    expect(await h.repositories.projects.find(ProjectId("prj_1"))).toBeNull();
    expect(await h.repositories.outbox.pendingCount()).toBe(0);
  });

  test("a Result reporting a refused rule commits, because nothing went wrong", async () => {
    // V3-SPEC §5: most refusals happen before anything is written, and treating
    // every Err as a rollback would discard the outbox row a use case writes
    // alongside a partial success.
    await givenWorkspace(h.repositories);

    const outcome = await h.unitOfWork.transact(async (repositories) => {
      await repositories.outbox.enqueue([envelope("e1")]);
      return err({ kind: "NameUnchanged" as const });
    });

    expect(outcome.ok).toBe(false);
    expect(await h.repositories.outbox.pendingCount()).toBe(1);
  });

  test("a constraint violation takes the whole transaction with it", async () => {
    const orphan = must(Project.create(ProjectId("prj_1"), "Web", WorkspaceId("ws_ghost"), T0));

    await expect(
      h.unitOfWork.transact(async (repositories) => {
        await repositories.outbox.enqueue([envelope("e1")]);
        await repositories.projects.save(orphan.project, orphan.events);
      }),
    ).rejects.toThrow(/projects_workspace_id_fkey/);

    expect(await h.repositories.outbox.pendingCount()).toBe(0);
  });

  test("loading a workspace inside a transaction makes the cap check serial", async () => {
    // The project cap is a read-then-write: count the projects, decide, insert.
    // Two transactions that both read "2 of 3" both proceed and the plan limit
    // becomes advisory. The row lock is the smallest thing that makes it true.
    const workspace = await givenWorkspace(h.repositories);
    const order: string[] = [];

    const first = h.unitOfWork.transact(async (repositories) => {
      await repositories.workspaces.find(workspace);
      order.push("first-holds");
      await sleep(300);
      const opened = must(Workspace.open(workspace, "Renamed", anAccount(), T0));
      await repositories.workspaces.save(opened.workspace, opened.events);
      order.push("first-commits");
    });

    await sleep(50);
    const second = h.unitOfWork.transact(async (repositories) => {
      await repositories.workspaces.find(workspace);
      order.push("second-holds");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first-holds", "first-commits", "second-holds"]);
  });

  test("a pooled read does not queue behind that lock", async () => {
    // A dashboard rendering while somebody renames the workspace must not wait
    // for the rename. Outside a transaction the lock would be released by the
    // next statement anyway, so it is not taken at all.
    const workspace = await givenWorkspace(h.repositories);
    const order: string[] = [];

    const writer = h.unitOfWork.transact(async (repositories) => {
      await repositories.workspaces.find(workspace);
      await sleep(250);
      order.push("writer-commits");
    });

    await sleep(50);
    await h.repositories.workspaces.find(workspace);
    order.push("reader-done");

    await writer;
    expect(order).toEqual(["reader-done", "writer-commits"]);
  });
});
