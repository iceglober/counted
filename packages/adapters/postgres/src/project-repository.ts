/**
 * `ProjectRepository` over Postgres.
 *
 * Ownership is two mutually exclusive column groups, and the DDL says so with a
 * CHECK: a claimed project has a workspace and a `claimed_at`; an unclaimed one
 * has a claim digest and an expiry. "Unclaimed" is a lifecycle state with its
 * own rules, not a nullable workspace id — v1 modelled it as a nullable claim
 * token and the claim link then never expired for any project that had events.
 * The constraint means a row cannot be half of each, whichever code path wrote
 * it.
 *
 * Only the digest of a claim token is stored, never the token. A database read
 * cannot hand anyone a working claim link.
 *
 * `delete` removes the row and lets the schema's cascades take the tiles and
 * monitors that read it. v1 deleted a project by running
 * `pool.query("DELETE FROM events …")` outside the surrounding transaction and
 * separately nulling dashboard owners — which is how dashboards with a NULL
 * owner came to exist, and every ownership guard in v1 read
 * `if (existing.userId && existing.userId !== session.user.id)`, so those
 * dashboards were readable, editable and publicly shareable by anyone signed
 * in.
 */

import { ProjectId, WorkspaceId, type Instant } from "@counted/kernel";
import {
  ClaimDigest,
  Project,
  RETENTION_INHERIT,
  type Ownership,
  type ProjectEvent,
  type RetentionPolicy,
} from "@counted/projects-domain";
import type { ProjectRepository, ProjectSummary } from "@counted/projects-ports";
import { RowDecodeError, instantOf, optionalTimestamp } from "./decode";
import { exec, firstRow, rows, type Queryable } from "./queryable";
import type { TenancyTree } from "./tenancy-tree";

type ProjectRow = {
  readonly id: string;
  readonly workspace_id: string | null;
  readonly name: string;
  readonly archived: boolean;
  readonly claimed_at: Date | null;
  readonly claim_digest: string | null;
  readonly claim_expires_at: Date | null;
  readonly retention_days: number | null;
};

const SELECT = `SELECT id, workspace_id, name, archived, claimed_at, claim_digest,
                       claim_expires_at, retention_days
                FROM projects`;

export class PostgresProjectRepository implements ProjectRepository<Project, ProjectEvent> {
  constructor(
    private readonly db: Queryable,
    /** Where the analytics engine learns this project exists. See `tenancy-tree.ts`. */
    private readonly tenancy: TenancyTree,
  ) {}

  async find(id: ProjectId): Promise<Project | null> {
    const row = await firstRow<ProjectRow>(this.db, `${SELECT} WHERE id = $1`, [id]);
    return row === null ? null : rehydrate(row);
  }

  async listForWorkspace(workspace: WorkspaceId): Promise<readonly Project[]> {
    const found = await rows<ProjectRow>(
      this.db,
      `${SELECT} WHERE workspace_id = $1 ORDER BY created_at, id`,
      [workspace],
    );
    return found.map(rehydrate);
  }

  /**
   * The list view's shape, read without rebuilding aggregates.
   *
   * Unclaimed projects are absent by construction — they have no workspace, so
   * `WHERE workspace_id = $1` cannot match one. That is the same predicate the
   * workspace's project register uses, which is why the two cannot disagree
   * about how many projects a workspace has.
   */
  async summariesForWorkspace(workspace: WorkspaceId): Promise<readonly ProjectSummary[]> {
    const found = await rows<{
      id: string;
      workspace_id: string;
      name: string;
      archived: boolean;
    }>(
      this.db,
      `SELECT id, workspace_id, name, archived FROM projects
       WHERE workspace_id = $1 ORDER BY created_at, id`,
      [workspace],
    );
    return found.map((row) => ({
      id: ProjectId(row.id),
      workspace: WorkspaceId(row.workspace_id),
      name: row.name,
      archived: row.archived,
    }));
  }

  /**
   * Upsert, never update. `events` is not written here: the outbox is a separate
   * repository handed out by the same transaction, so a use case writes the
   * aggregate and its events side by side.
   */
  async save(project: Project, events: readonly ProjectEvent[]): Promise<void> {
    const s = project.snapshot();
    const claimed = s.ownership.state === "claimed" ? s.ownership : null;
    const unclaimed = s.ownership.state === "unclaimed" ? s.ownership : null;

    await exec(
      this.db,
      `INSERT INTO projects
         (id, workspace_id, name, archived, claimed_at, claim_digest, claim_expires_at, retention_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE
         SET workspace_id = EXCLUDED.workspace_id,
             name = EXCLUDED.name,
             archived = EXCLUDED.archived,
             claimed_at = EXCLUDED.claimed_at,
             claim_digest = EXCLUDED.claim_digest,
             claim_expires_at = EXCLUDED.claim_expires_at,
             retention_days = EXCLUDED.retention_days,
             updated_at = now()`,
      [
        s.id,
        claimed?.workspace ?? null,
        s.name,
        s.archived,
        optionalTimestamp(claimed?.claimedAt ?? null),
        unclaimed?.grant.digest ?? null,
        optionalTimestamp(unclaimed?.grant.expiresAt ?? null),
        s.retention.kind === "days" ? s.retention.days : null,
      ],
    );

    /**
     * The project's place in the analytics tenancy tree, written in the same
     * transaction as the row above.
     *
     * Without it every query about this project answers zero — see
     * `tenancy-tree.ts`. `parent` is the workspace, or null while the project
     * is unclaimed: an unclaimed project still needs its own row, because the
     * tenant filter resolves a *project* scope through the closure table too.
     * Claiming re-parents it, which litics' trigger handles.
     */
    const place = this.tenancy.place(s.id, claimed?.workspace ?? null);
    await exec(this.db, place.sql, [...place.parameters]);
  }

  async delete(id: ProjectId): Promise<void> {
    await exec(this.db, `DELETE FROM projects WHERE id = $1`, [id]);
    const remove = this.tenancy.remove(id);
    await exec(this.db, remove.sql, [...remove.parameters]);
  }
}

const ownershipOf = (row: ProjectRow): Ownership => {
  if (row.workspace_id !== null && row.claimed_at !== null) {
    return {
      state: "claimed",
      workspace: WorkspaceId(row.workspace_id),
      claimedAt: instantOf(row.claimed_at),
    };
  }
  if (row.claim_digest !== null && row.claim_expires_at !== null) {
    return {
      state: "unclaimed",
      grant: { digest: ClaimDigest(row.claim_digest), expiresAt: instantOf(row.claim_expires_at) },
    };
  }
  // Unreachable while `projects_ownership_is_exclusive` holds. Kept because a
  // row written before that constraint existed would otherwise rehydrate into a
  // project that is neither owned nor claimable, and the aggregate has no state
  // to represent that — it would just quietly refuse every command.
  throw new RowDecodeError("projects", row.id, "workspace_id", row.workspace_id);
};

const retentionOf = (row: ProjectRow): RetentionPolicy =>
  row.retention_days === null ? RETENTION_INHERIT : { kind: "days", days: row.retention_days };

const rehydrate = (row: ProjectRow): Project =>
  Project.rehydrate({
    id: ProjectId(row.id),
    name: row.name,
    ownership: ownershipOf(row),
    archived: row.archived,
    retention: retentionOf(row),
  });


/** Lifecycle boundary for provisional ingest usage, without exposing storage metadata in the project aggregate. */
export const projectCreatedAt = async (db: Queryable, project: ProjectId): Promise<Instant | null> => {
  const row = await firstRow<{created_at: Date}>(db, "SELECT created_at FROM projects WHERE id = $1", [project]);
  return row === null ? null : instantOf(row.created_at);
};
