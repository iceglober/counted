/**
 * What any WorkspaceRepository must do.
 *
 * The point of writing this down as code: `@counted/adapter-postgres` and the
 * in-memory double in `../testing.ts` are supposed to be interchangeable, and
 * until now nothing checked. They were not. `PostgresWorkspaceRepository`
 * derives the project register with a `SELECT` over the `projects` table while
 * the fake keeps its own list, so an ordering bug that made every project
 * creation return 409 in production was invisible to two thousand unit tests.
 * That divergence is now a harness method — `givenProject` — which each side
 * implements the way its own composition root does, and every assertion after
 * it runs against both.
 *
 * **What `save` is and is not.** It persists the workspace's own state: id,
 * name, plan, payment. It does NOT persist the project register, because the
 * register is one record of a number the `projects` table already holds and
 * writing both is the two-counts defect `project-count.ts` exists to close.
 * The suite therefore never asserts that `save(workspace.registerProject(…))`
 * alone is visible to `find` — it asks the harness to write a project the way
 * the composition root does, and then asserts the register reflects it.
 *
 * **Events are handed to `save` and not read back.** There is no read side for
 * them in this port: the outbox is a separate repository the same transaction
 * hands out. What the suite can and does check is that passing them is not an
 * error, and that passing none is not either.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { ROLES, type AccountId, type Instant, type ProjectId, type Role, type WorkspaceId } from "@counted/kernel";
import { Workspace, type WorkspaceEvent } from "@counted/tenancy-domain";
import type { WorkspaceRepository } from "../ports";

export type WorkspaceRepositoryHarness = {
  readonly workspaces: WorkspaceRepository;
  /** An id nothing in this harness has used yet. */
  freshWorkspace(): WorkspaceId;
  freshProject(): ProjectId;
  freshAccount(): AccountId;
  /**
   * Seat `account` in `workspace` at `role`, wherever this implementation keeps
   * membership — better-auth's `member` table for the real one, a map for the
   * fake. `listForAccount` has to answer from it, and neither side may make one
   * up.
   */
  givenMember(workspace: WorkspaceId, account: AccountId, role: Role): Promise<void>;
  /**
   * Register a project the way this implementation's composition root does.
   *
   * For the fake that is `registerProject` then `save`. For Postgres it is that
   * *and* a row in `projects`, because the register is derived from those rows.
   * Naming the difference here is what stops it hiding.
   */
  givenProject(workspace: WorkspaceId, project: ProjectId, name: string): Promise<void>;
  /** Archive a project that `givenProject` created. Archiving frees its slot. */
  givenArchivedProject(workspace: WorkspaceId, project: ProjectId): Promise<void>;
  teardown?(): Promise<void>;
};

export const workspaceRepositoryContract = (
  label: string,
  create: () => Promise<WorkspaceRepositoryHarness> | WorkspaceRepositoryHarness,
  at: Instant,
): void => {
  describe(`WorkspaceRepository contract: ${label}`, () => {
    let h!: WorkspaceRepositoryHarness;

    beforeEach(async () => {
      h = await create();
    });
    afterEach(async () => {
      await h.teardown?.();
    });

    /** Open a workspace and persist it, returning the id. */
    const opened = async (name = "Acme"): Promise<WorkspaceId> => {
      const id = h.freshWorkspace();
      const result = Workspace.open(id, name, h.freshAccount(), at);
      if (!result.ok) throw new Error(`harness: opening a workspace was refused`);
      await h.workspaces.save(result.value.workspace, result.value.events);
      return id;
    };

    const load = async (id: WorkspaceId): Promise<Workspace> => {
      const found = await h.workspaces.find(id);
      if (found === null) throw new Error(`expected workspace ${String(id)} to exist`);
      return found;
    };

    // ── find and save ─────────────────────────────────────────────────────

    test("find answers null for an id nothing wrote, rather than throwing", async () => {
      expect(await h.workspaces.find(h.freshWorkspace())).toBeNull();
    });

    test("save creates a workspace that did not exist", async () => {
      // The shape v1 got wrong everywhere: an update that matches nothing and
      // reports success. There is no update-shaped method on this port, and
      // this is the assertion that keeps it that way.
      const id = await opened("Acme");
      const found = await load(id);
      expect(found.id).toBe(id);
      expect(found.name).toBe("Acme");
      expect(found.plan).toBe("free");
      expect(found.payment).toBe("none");
    });

    test("save is an upsert: saving the same workspace twice updates it in place", async () => {
      const id = await opened("Acme");
      const renamed = (await load(id)).rename("Acme Rebranded", at);
      if (!renamed.ok) throw new Error("rename was refused");
      await h.workspaces.save(renamed.value.workspace, renamed.value.events);

      expect((await load(id)).name).toBe("Acme Rebranded");
      // Not two rows wearing one id. `listForAccount` is the only read that
      // could show a duplicate, so it is the one that has to be asked.
      const account = h.freshAccount();
      await h.givenMember(id, account, "owner");
      expect((await h.workspaces.listForAccount(account)).length).toBe(1);
    });

    test("saving with no events is allowed, and so is saving with several", async () => {
      const id = h.freshWorkspace();
      const result = Workspace.open(id, "Acme", h.freshAccount(), at);
      if (!result.ok) throw new Error("opening was refused");
      await h.workspaces.save(result.value.workspace, []);
      await h.workspaces.save(result.value.workspace, result.value.events);
      expect((await load(id)).name).toBe("Acme");
    });

    // ── the standing round trip ───────────────────────────────────────────

    test("plan and payment survive the round trip, and the entitlement is re-derived", async () => {
      // Not stored. `Entitlement.resolve` is the one definition of "is this
      // customer on Pro?", and a repository that persisted the answer instead
      // of the inputs would be a second one.
      const id = await opened();
      const paid = (await load(id)).applyStanding({ plan: "pro", payment: "active" }, { seats: 1 }, at);
      await h.workspaces.save(paid.workspace, paid.events);

      const found = await load(id);
      expect(found.plan).toBe("pro");
      expect(found.payment).toBe("active");
      expect(found.entitlement.limits.eventsPerMonth).toBe(1_000_000);
      expect(found.limits.maxProjects).toBeNull();
      expect(found.entitlement.inGrace).toBe(false);
    });

    test("a past-due workspace comes back in grace, keeping its paid limits", async () => {
      const id = await opened();
      const paid = (await load(id)).applyStanding({ plan: "pro", payment: "active" }, { seats: 1 }, at);
      await h.workspaces.save(paid.workspace, paid.events);
      const late = (await load(id)).applyStanding({ plan: "pro", payment: "past_due" }, { seats: 1 }, at);
      await h.workspaces.save(late.workspace, late.events);

      const found = await load(id);
      expect(found.entitlement.inGrace).toBe(true);
      expect(found.entitlement.plan).toBe("pro");
    });

    test("a canceled workspace keeps its plan for history and is entitled to free", async () => {
      const id = await opened();
      const paid = (await load(id)).applyStanding({ plan: "pro", payment: "active" }, { seats: 1 }, at);
      await h.workspaces.save(paid.workspace, paid.events);
      const gone = (await load(id)).applyStanding({ plan: "pro", payment: "canceled" }, { seats: 1 }, at);
      await h.workspaces.save(gone.workspace, gone.events);

      const found = await load(id);
      expect(found.plan).toBe("pro");
      expect(found.entitlement.plan).toBe("free");
      expect(found.limits.maxProjects).toBe(3);
    });

    // ── the project register ──────────────────────────────────────────────

    test("the register reflects projects the composition root wrote", async () => {
      const id = await opened();
      const first = h.freshProject();
      const second = h.freshProject();
      await h.givenProject(id, first, "Web");
      await h.givenProject(id, second, "Mobile");

      const found = await load(id);
      expect(found.projectCount).toBe(2);
      expect(found.projects.map((p) => p.name).sort()).toEqual(["Mobile", "Web"]);
    });

    test("a project registered once cannot be registered again on a freshly loaded workspace", async () => {
      // The defect this catches is an ordering one, and it is only reachable
      // when the register is derived: create the project row first and the
      // workspace loaded afterwards already contains it, so `registerProject`
      // refuses with `ProjectExists` and every creation returns 409.
      const id = await opened();
      const project = h.freshProject();
      await h.givenProject(id, project, "Web");

      const again = (await load(id)).registerProject(project, "Web", at);
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.kind).toBe("ProjectExists");
    });

    test("archiving frees the slot, and the archived project is still listed", async () => {
      const id = await opened();
      const project = h.freshProject();
      await h.givenProject(id, project, "Web");
      await h.givenArchivedProject(id, project);

      const found = await load(id);
      expect(found.projectCount).toBe(0);
      expect(found.projects.length).toBe(1);
      expect(found.projects[0]?.state).toBe("archived");
    });

    test("the cap is enforced against the register that came back from storage", async () => {
      // Three is the free plan's published limit. A repository that lost the
      // register would let a fourth through, and the only symptom would be a
      // customer with more projects than they are paying for.
      const id = await opened();
      for (const name of ["One", "Two", "Three"]) {
        await h.givenProject(id, h.freshProject(), name);
      }
      const fourth = (await load(id)).registerProject(h.freshProject(), "Four", at);
      expect(fourth.ok).toBe(false);
      if (!fourth.ok) {
        expect(fourth.error.kind).toBe("ProjectLimitReached");
        if (fourth.error.kind === "ProjectLimitReached") expect(fourth.error.limit).toBe(3);
      }
    });

    test("one workspace's projects never appear in another's register", async () => {
      const mine = await opened("Mine");
      const theirs = await opened("Theirs");
      await h.givenProject(mine, h.freshProject(), "Web");

      expect((await load(mine)).projectCount).toBe(1);
      expect((await load(theirs)).projectCount).toBe(0);
    });

    // ── listForAccount ────────────────────────────────────────────────────

    for (const role of ROLES) {
      test(`listForAccount reports a ${role}'s workspace with that role`, async () => {
        const id = await opened("Acme");
        const account = h.freshAccount();
        await h.givenMember(id, account, role);

        expect(await h.workspaces.listForAccount(account)).toEqual([
          { id, name: "Acme", role },
        ]);
      });
    }

    test("listForAccount is empty for an account that belongs nowhere", async () => {
      await opened();
      expect(await h.workspaces.listForAccount(h.freshAccount())).toEqual([]);
    });

    test("listForAccount never leaks a workspace the account is not a member of", async () => {
      const mine = await opened("Mine");
      await opened("Theirs");
      const account = h.freshAccount();
      await h.givenMember(mine, account, "member");

      const listed = await h.workspaces.listForAccount(account);
      expect(listed.map((summary) => summary.id)).toEqual([mine]);
    });

    test("listForAccount reports every workspace an account belongs to, once each", async () => {
      const first = await opened("Alpha");
      const second = await opened("Beta");
      const account = h.freshAccount();
      await h.givenMember(first, account, "owner");
      await h.givenMember(second, account, "admin");

      const listed = await h.workspaces.listForAccount(account);
      expect(listed.length).toBe(2);
      expect([...new Set(listed.map((s) => s.id))].length).toBe(2);
    });

    test("a membership pointing at a workspace with no row is dropped, not invented", async () => {
      // better-auth's organization and the domain's workspace share an id and
      // are created together, so the only way to reach this state is a
      // half-finished creation — and a workspace rendered with no plan is worse
      // than one that is not listed.
      const account = h.freshAccount();
      await h.givenMember(h.freshWorkspace(), account, "owner");
      expect(await h.workspaces.listForAccount(account)).toEqual([]);
    });

    // ── events ────────────────────────────────────────────────────────────

    test("save accepts every event the aggregate can emit", async () => {
      const id = await opened();
      const workspace = await load(id);
      const emitted: WorkspaceEvent[] = [
        { kind: "WorkspaceRenamed", workspace: id, name: "Renamed", at },
        { kind: "PlanChanged", workspace: id, from: "free", to: "pro", at },
        { kind: "PaymentStateChanged", workspace: id, from: "none", to: "active", at },
      ];
      await h.workspaces.save(workspace, emitted);
      expect((await load(id)).id).toBe(id);
    });
  });
};
