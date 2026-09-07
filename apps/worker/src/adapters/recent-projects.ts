/**
 * Projects created recently enough that provisioning could still be
 * unfinished.
 *
 * **This belongs in `@counted/projects-ports`**, next to `RetentionTargets`
 * and for the same reason: `ProjectRepository` answers `find` and
 * `listForWorkspace`, and a reconciler has no workspace to start from. It is
 * here because the worker is its only caller.
 *
 * Bounded by time and not by a cursor, unlike the retention walk. The
 * reconciler is looking for the residue of a crash, and a crash is recent by
 * definition — an orphan from six months ago has either been noticed or is
 * never going to be. An unbounded walk would also make the job's cost grow
 * with the size of the installation forever, for a defect whose rate does not.
 *
 * Unclaimed projects are excluded. Their keys belong to the holding workspace
 * and this reconciler is not told which one that is; more to the point their
 * claim grant expires, so an unrepaired one stops admitting events on its own
 * rather than sitting broken.
 */

import { Instant, ProjectId, WorkspaceId } from "@counted/kernel";

import type { ProjectRecord, RecentProjects } from "../ports";

type Row = {
  readonly id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly created_at: Date | string;
};

export interface ProjectQueryable {
  query<R extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

const RECENT = `
  SELECT p.id, p.workspace_id, p.name, p.created_at
    FROM projects p
   WHERE p.workspace_id IS NOT NULL
     AND p.archived = false
     AND p.created_at >= $1
   ORDER BY p.created_at
   LIMIT $2`;

export const postgresRecentProjects = (db: ProjectQueryable): RecentProjects => ({
  async createdSince(since: Instant, limit: number): Promise<readonly ProjectRecord[]> {
    const result = await db.query<Row>(RECENT, [Instant.toDate(since), limit]);
    return result.rows.map((row) => ({
      project: ProjectId(row.id),
      workspace: WorkspaceId(row.workspace_id),
      name: row.name,
      createdAt: Instant.fromDate(new Date(row.created_at)),
    }));
  },
});
