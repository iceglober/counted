/**
 * What a WorkspaceRepository over Postgres has to get right.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";
import { ProjectId, WorkspaceId } from "@counted/kernel";
import { ClaimDigest, Project } from "@counted/projects-domain";
import {
  T0,
  anAccount,
  at,
  givenProject,
  givenWorkspace,
  liveHarness,
  must,
  type Harness,
} from "./fixtures";
import { closeDatabase, describeLive } from "./testing";

describeLive("PostgresWorkspaceRepository", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await liveHarness();
    await h.reset();
  });
  afterAll(closeDatabase);

  test("saving a workspace that does not exist creates it", async () => {
    // v1's billing handler was an `UPDATE … WHERE user_id = $1`, which matched
    // nothing for every first-time subscriber and reported success. Nothing in
    // this package is allowed to have an update-shaped write.
    const id = await givenWorkspace(h.repositories);
    const found = await h.repositories.workspaces.find(id);
    expect(found?.name).toBe("Acme");
    expect(found?.plan).toBe("free");
    expect(found?.payment).toBe("none");
  });

  test("find answers null for an unknown id rather than throwing", async () => {
    expect(await h.repositories.workspaces.find(WorkspaceId("ws_nope"))).toBeNull();
  });

  test("plan and payment survive a round trip, and limits are re-derived from them", async () => {
    const id = await givenWorkspace(h.repositories);
    const loaded = await h.repositories.workspaces.find(id);
    const paid = loaded!.applyStanding({ plan: "pro", payment: "active" }, { seats: 1 }, T0);
    await h.repositories.workspaces.save(paid.workspace, paid.events);

    const reloaded = await h.repositories.workspaces.find(id);
    expect(reloaded?.plan).toBe("pro");
    // v2 stored the limits alongside the plan and its Postgres adapter loaded
    // every workspace with UNLIMITED, so a rehydrated workspace enforced no cap
    // at all. Limits are not a column here; they are resolved from these two.
    expect(reloaded?.limits.maxProjects).toBeNull();
  });

  test("the project register is the project table, so the two cannot disagree", async () => {
    // v2 checked the cap against active projects and loaded the register with no
    // state filter, so one workspace could be at 3/3 and at 5/3 at once. Here the
    // register is a SELECT over the same rows the project repository writes.
    const workspace = await givenWorkspace(h.repositories);
    await givenProject(h.repositories, workspace, "prj_a", "A");
    await givenProject(h.repositories, workspace, "prj_b", "B");

    const loaded = await h.repositories.workspaces.find(workspace);
    expect(loaded?.projects.map((p) => p.name)).toEqual(["A", "B"]);
    expect(loaded?.projectCount).toBe(2);

    const project = await h.repositories.projects.find(ProjectId("prj_a"));
    const archived = must(project!.archive(T0));
    await h.repositories.projects.save(archived.project, archived.events);

    const after = await h.repositories.workspaces.find(workspace);
    expect(after?.projects).toHaveLength(2);
    // Archiving frees the slot. One rule, one count, both sides of it.
    expect(after?.projectCount).toBe(1);
  });

  test("an unclaimed project belongs to no register", async () => {
    // A project with no workspace consumes no slot and appears in no cap check.
    // The register's predicate is `workspace_id = $1`, which cannot match one.
    const workspace = await givenWorkspace(h.repositories);
    const orphan = must(
      Project.provisionUnclaimed(
        ProjectId("prj_free"),
        "Unclaimed",
        { digest: ClaimDigest("d".repeat(64)), expiresAt: at(60) },
        T0,
      ),
    );
    await h.repositories.projects.save(orphan.project, orphan.events);

    const loaded = await h.repositories.workspaces.find(workspace);
    expect(loaded?.projects).toEqual([]);
  });

  test("listForAccount returns only workspaces the account is a member of, with its role", async () => {
    const acme = await givenWorkspace(h.repositories, "ws_acme", "Acme");
    await givenWorkspace(h.repositories, "ws_other", "Other");
    const account = anAccount("grace");
    h.memberships.put(account, { workspace: acme, role: "admin" });

    const listed = await h.repositories.workspaces.listForAccount(account);
    expect(listed).toEqual([{ id: acme, name: "Acme", role: "admin" }]);
  });

  test("a membership pointing at a workspace with no row is dropped, not invented", async () => {
    // better-auth's organization and the domain's workspace share an id and are
    // created together, so this state means a half-finished creation. Listing a
    // workspace with no plan is worse than not listing it.
    const account = anAccount("half");
    h.memberships.put(account, { workspace: WorkspaceId("ws_ghost"), role: "owner" });
    expect(await h.repositories.workspaces.listForAccount(account)).toEqual([]);
  });

  test("an account with no memberships never reaches the database", async () => {
    expect(await h.repositories.workspaces.listForAccount(anAccount("nobody"))).toEqual([]);
  });

  test("a plan the catalogue does not know is refused loudly, not defaulted", async () => {
    const id = await givenWorkspace(h.repositories);
    await h.pool.query(`UPDATE workspaces SET plan = 'enterprise' WHERE id = $1`, [id]);
    expect(h.repositories.workspaces.find(id)).rejects.toThrow(/workspaces\.plan/);
  });
});
