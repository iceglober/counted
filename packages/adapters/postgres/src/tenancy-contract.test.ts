/**
 * The tenancy port contracts, run against a real Postgres.
 *
 * These are not this package's tests. They are the ports', defined in
 * `@counted/tenancy-app/contract`, and the in-memory doubles in
 * `@counted/tenancy-app/testing` run the same ones. Two implementations, one
 * definition of correct — which is the only thing that makes "we could swap the
 * database out" more than an aspiration, and the only thing that turns a
 * divergence into a failing test rather than a production incident.
 *
 * The file-local suites beside this one stay: they assert things that are true
 * of *Postgres* — a partial unique index, a `SELECT … FOR UPDATE` inside a
 * transaction, a decoder that refuses an unknown plan loudly. Those are not
 * port obligations and a second implementation would not owe them.
 *
 * **The one asymmetry the contract makes visible.** `givenProject` here writes
 * a `projects` row as well as saving the workspace, because
 * `PostgresWorkspaceRepository` derives the project register with a `SELECT`
 * over that table while the fake keeps its own list. That difference cost a
 * whole rebuild: `apps/api`'s create-project route reserved the workspace slot
 * *after* provisioning the project row, so the workspace loaded afterwards
 * already contained it, `registerProject` refused with `ProjectExists`, and
 * every console project creation returned 409. Fakes could not see it. The
 * harness method is where it now lives in the open.
 */

import { afterAll } from "bun:test";
import { AccountId, ProjectId, WorkspaceId } from "@counted/kernel";
import { Project } from "@counted/projects-domain";
import { Workspace } from "@counted/tenancy-domain";
import {
  subscriptionRepositoryContract,
  webhookLedgerContract,
  workspaceRepositoryContract,
} from "@counted/tenancy-app/contract";
import { T0, liveHarness, must, type Harness } from "./fixtures";
import { closeDatabase, databaseAvailable, describeLive } from "./testing";

/**
 * Unique per test, because `beforeEach` truncates but the contract mints ids
 * through the harness and two suites in one file share this counter.
 */
let sequence = 0;
const next = (): number => (sequence += 1);

const freshHarness = async (): Promise<Harness> => {
  const h = await liveHarness();
  await h.reset();
  return h;
};

if (databaseAvailable) {
  workspaceRepositoryContract(
    "postgres",
    async () => {
      const h = await freshHarness();

      const load = async (workspace: WorkspaceId): Promise<Workspace> => {
        const found = await h.repositories.workspaces.find(workspace);
        if (found === null) throw new Error(`harness: no workspace ${String(workspace)}`);
        return found;
      };

      return {
        workspaces: h.repositories.workspaces,
        freshWorkspace: () => WorkspaceId(`ws_${next()}`),
        freshProject: () => ProjectId(`prj_${next()}`),
        freshAccount: () => AccountId(`acct_${next()}`),
        givenMember: async (workspace, account, role) => {
          // better-auth owns the rows; `StubMemberships` is the seam the
          // composition root fills with a lookup over the identity adapter.
          h.memberships.put(account, { workspace, role });
        },
        /**
         * Both halves, in the order the composition root uses: reserve the
         * slot on the workspace first, then write the project row. The reverse
         * order is the 409 described above, and `find`'s `SELECT … FOR UPDATE`
         * is what makes the reservation the serialisation point.
         */
        givenProject: async (workspace, project, name) => {
          const registered = must(
            (await load(workspace)).registerProject(project, name, T0),
          );
          await h.repositories.workspaces.save(registered.workspace, registered.events);
          const created = must(Project.create(project, name, workspace, T0));
          await h.repositories.projects.save(created.project, created.events);
        },
        givenArchivedProject: async (workspace, project) => {
          const archivedInWorkspace = must((await load(workspace)).archiveProject(project, T0));
          await h.repositories.workspaces.save(
            archivedInWorkspace.workspace,
            archivedInWorkspace.events,
          );
          const found = await h.repositories.projects.find(project);
          if (found === null) throw new Error(`harness: no project ${String(project)}`);
          const archived = must(found.archive(T0));
          await h.repositories.projects.save(archived.project, archived.events);
        },
      };
    },
    T0,
  );

  subscriptionRepositoryContract(
    "postgres",
    async () => {
      const h = await freshHarness();
      return {
        subscriptions: h.repositories.subscriptions,
        // `subscriptions.workspace_id` is a foreign key, so the row has to
        // exist. The fake has no such constraint, which is why standing the
        // workspace up is the harness's job and not the suite's.
        givenWorkspace: async () => {
          const id = WorkspaceId(`ws_${next()}`);
          const opened = must(Workspace.open(id, `Acme ${next()}`, AccountId("acct_founder"), T0));
          await h.repositories.workspaces.save(opened.workspace, opened.events);
          return id;
        },
        unknownWorkspace: () => WorkspaceId("ws_nobody"),
      };
    },
    T0,
  );

  webhookLedgerContract(
    "postgres",
    async () => {
      const h = await freshHarness();
      return {
        ledger: h.repositories.webhooks,
        freshEventId: () => `evt_${next()}`,
      };
    },
    T0,
  );

  afterAll(closeDatabase);
} else {
  describeLive("tenancy port contracts: postgres", () => {
    // `describeLive` is `describe.skip` without a database, so this reports as
    // skipped rather than passing silently.
  });
}
