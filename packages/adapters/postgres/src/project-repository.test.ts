/**
 * What a ProjectRepository over Postgres has to get right.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";
import { ProjectId, WorkspaceId } from "@counted/kernel";
import { ClaimDigest, Project } from "@counted/projects-domain";
import { T0, at, givenProject, givenWorkspace, liveHarness, must, type Harness } from "./fixtures";
import { closeDatabase, describeLive } from "./testing";

const DIGEST = "a".repeat(64);

describeLive("PostgresProjectRepository", () => {
  let h: Harness;
  let workspace: WorkspaceId;

  beforeEach(async () => {
    h = await liveHarness();
    await h.reset();
    workspace = await givenWorkspace(h.repositories);
  });
  afterAll(closeDatabase);

  test("a claimed project round-trips its ownership", async () => {
    const id = await givenProject(h.repositories, workspace);
    const found = await h.repositories.projects.find(id);
    expect(found?.workspace).toBe(workspace);
    expect(found?.isClaimed).toBe(true);
    expect(found?.name).toBe("Web");
  });

  test("an unclaimed project keeps its grant, and claiming it drops the grant", async () => {
    // Single use is the whole point: after a claim there is no longer a digest
    // to present. v1 modelled this as a nullable claim token and the link then
    // never expired for any project that had events.
    const provisioned = must(
      Project.provisionUnclaimed(
        ProjectId("prj_open"),
        "Agent",
        { digest: ClaimDigest(DIGEST), expiresAt: at(60) },
        T0,
      ),
    );
    await h.repositories.projects.save(provisioned.project, provisioned.events);

    const loaded = await h.repositories.projects.find(ProjectId("prj_open"));
    expect(loaded?.ownership).toEqual({
      state: "unclaimed",
      grant: { digest: ClaimDigest(DIGEST), expiresAt: at(60) },
    });

    const claimed = must(loaded!.claim(ClaimDigest(DIGEST), workspace, at(1)));
    await h.repositories.projects.save(claimed.project, claimed.events);

    const after = await h.repositories.projects.find(ProjectId("prj_open"));
    expect(after?.workspace).toBe(workspace);
    const { rows } = await h.pool.query<{ claim_digest: string | null }>(
      `SELECT claim_digest FROM projects WHERE id = 'prj_open'`,
    );
    expect(rows[0]?.claim_digest).toBeNull();
  });

  test("a row cannot be half claimed and half claimable", async () => {
    // "Unclaimed" is a lifecycle state with rules, not the absence of a
    // workspace id. The CHECK holds that whichever code path writes the row.
    expect(
      h.pool.query(
        `INSERT INTO projects (id, workspace_id, name, claimed_at, claim_digest, claim_expires_at)
         VALUES ('prj_bad', $1, 'Half', now(), $2, now())`,
        [workspace, DIGEST],
      ),
    ).rejects.toThrow(/projects_ownership_is_exclusive/);
  });

  test("retention round-trips both of its shapes", async () => {
    const id = await givenProject(h.repositories, workspace);
    const loaded = await h.repositories.projects.find(id);
    expect(loaded?.retention).toEqual({ kind: "inherit" });

    const pinned = must(loaded!.setRetention({ kind: "days", days: 30 }, T0));
    await h.repositories.projects.save(pinned.project, pinned.events);
    expect((await h.repositories.projects.find(id))?.retention).toEqual({ kind: "days", days: 30 });
  });

  test("summaries list only the workspace's own projects, archived ones included", async () => {
    await givenProject(h.repositories, workspace, "prj_a", "A");
    const b = await givenProject(h.repositories, workspace, "prj_b", "B");
    const archived = must((await h.repositories.projects.find(b))!.archive(T0));
    await h.repositories.projects.save(archived.project, archived.events);

    const unclaimed = must(
      Project.provisionUnclaimed(
        ProjectId("prj_open"),
        "Agent",
        { digest: ClaimDigest(DIGEST), expiresAt: at(60) },
        T0,
      ),
    );
    await h.repositories.projects.save(unclaimed.project, unclaimed.events);

    expect(await h.repositories.projects.summariesForWorkspace(workspace)).toEqual([
      { id: ProjectId("prj_a"), workspace, name: "A", archived: false },
      { id: ProjectId("prj_b"), workspace, name: "B", archived: true },
    ]);
  });

  test("deleting a project takes the tiles and monitors that read it", async () => {
    // v1 deleted a project by nulling dashboard owners and running its
    // `DELETE FROM events` outside the surrounding transaction. Dashboards with
    // a NULL owner then passed every ownership guard in the codebase, because
    // each one read `if (existing.userId && existing.userId !== session…)`.
    const project = await givenProject(h.repositories, workspace);
    await h.pool.query(
      `INSERT INTO dashboards (id, workspace_id, name) VALUES ('dsh_1', $1, 'Board')`,
      [workspace],
    );
    await h.pool.query(
      `INSERT INTO dashboard_tiles (dashboard_id, id, position, title, project_id, analysis, view, width)
       VALUES ('dsh_1', 'tile_1', 0, 'Signups', $1, '{}'::jsonb, 'number', 6)`,
      [project],
    );

    await h.repositories.projects.delete(project);

    expect(await h.repositories.projects.find(project)).toBeNull();
    const tiles = await h.pool.query(`SELECT 1 FROM dashboard_tiles`);
    expect(tiles.rowCount).toBe(0);
    // The dashboard itself survives — losing a project is not a reason to lose
    // the page it was on.
    const dashboards = await h.pool.query(`SELECT 1 FROM dashboards`);
    expect(dashboards.rowCount).toBe(1);
  });

  test("deleting a workspace takes its projects with it", async () => {
    await givenProject(h.repositories, workspace);
    await h.pool.query(`DELETE FROM workspaces WHERE id = $1`, [workspace]);
    expect(await h.repositories.projects.summariesForWorkspace(workspace)).toEqual([]);
  });
});
