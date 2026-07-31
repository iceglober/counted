/**
 * The authorization lookups, in SQL.
 *
 * This is the only place a wrong query could make a right rule give a wrong
 * answer, which is why it is this small and why every query below is a single
 * indexed read.
 *
 * Nothing here decides anything. It answers three questions and hands the
 * values to the domain.
 */

import type { Pool } from "pg";
import {
  AccountId,
  CredentialId,
  DashboardId,
  Instant,
  Principal,
  ProjectId,
  WorkspaceId,
  type Placement,
  type Resource,
  type Role,
  type Scope,
} from "@counted/domain";
import type { AccessResolver, PresentedCredential } from "@counted/ports";

const ROLES: readonly string[] = ["owner", "admin", "member"];
const isRole = (raw: unknown): raw is Role => typeof raw === "string" && ROLES.includes(raw);

/**
 * Scopes come back from a jsonb column, so they are `unknown` until checked.
 *
 * An unrecognised scope string is dropped rather than carried: a scope the
 * domain does not know is a scope nothing will ever grant, and passing it
 * through would put an unenforceable claim inside a principal.
 */
const readScopes = (raw: unknown): readonly Scope[] =>
  Array.isArray(raw) ? (raw.filter((s): s is Scope => typeof s === "string") as Scope[]) : [];

export const createAccessResolver = (pool: Pool): AccessResolver => ({
  async principalFor(presented: PresentedCredential, at: Instant): Promise<Principal> {
    const now = new Date(Instant.toEpochMillis(at));

    // A share grant lives on its dashboard rather than in `credentials`,
    // because it is a property of the thing shared and dies with it.
    if (presented.claimedKind === "share") {
      const { rows } = await pool.query<{ id: string; tiles: unknown }>(
        `SELECT id, tiles FROM dashboards
          WHERE share_digest = $1 AND share_expires_at > $2`,
        [presented.digest, now],
      );
      const row = rows[0];
      if (row === undefined) return Principal.ANONYMOUS;
      // A share link may run exactly the queries the page it shows needs. The
      // projects come from the tiles, so revoking a tile narrows the link.
      const projects = Array.isArray(row.tiles)
        ? [
            ...new Set(
              row.tiles
                .map((t) => (typeof t === "object" && t !== null ? (t as { project?: unknown }).project : null))
                .filter((p): p is string => typeof p === "string"),
            ),
          ].map(ProjectId)
        : [];
      return {
        kind: "share",
        credential: CredentialId(row.id),
        dashboard: DashboardId(row.id),
        projects,
        scopes: ["dashboards:read", "queries:run"],
      };
    }

    // One indexed read on a unique digest. No candidate scan, so nothing here
    // has a timing signal that depends on how close a guess was.
    const { rows } = await pool.query<{
      id: string;
      kind: string;
      project_id: string;
      workspace_id: string | null;
      scopes: unknown;
    }>(
      `SELECT c.id, c.kind, c.project_id, p.workspace_id, c.scopes
         FROM credentials c
         JOIN projects p ON p.id = c.project_id
        WHERE c.digest = $1
          AND c.revoked_at IS NULL
          AND (c.expires_at IS NULL OR c.expires_at > $2)`,
      [presented.digest, now],
    );
    const row = rows[0];
    if (row === undefined) return Principal.ANONYMOUS;

    if (row.kind === "ingest") {
      return {
        kind: "ingest",
        credential: CredentialId(row.id),
        project: ProjectId(row.project_id),
        scopes: readScopes(row.scopes),
      };
    }

    // A service key on an unclaimed project has no workspace to be bound to,
    // and an unbound key is not a lesser key — it is an unusable one.
    if (row.workspace_id === null) return Principal.ANONYMOUS;

    return {
      kind: "service",
      credential: CredentialId(row.id),
      workspace: WorkspaceId(row.workspace_id),
      projects: [ProjectId(row.project_id)],
      scopes: readScopes(row.scopes),
      // Audit author. Filled in properly when key issuance records its issuer;
      // until then a key's creations are attributed to the credential itself
      // rather than to a fabricated owner with an empty user id, which is what
      // v1 wrote into `created_by`.
      onBehalfOf: AccountId(row.id),
    };
  },

  async placementOf(resource: Resource): Promise<Placement | null> {
    switch (resource.type) {
      case "workspace": {
        const { rows } = await pool.query<{ id: string }>(`SELECT id FROM workspaces WHERE id = $1`, [
          resource.id,
        ]);
        const row = rows[0];
        return row === undefined ? null : { workspace: WorkspaceId(row.id), project: null };
      }
      case "project": {
        const { rows } = await pool.query<{ id: string; workspace_id: string | null }>(
          `SELECT id, workspace_id FROM projects WHERE id = $1`,
          [resource.id],
        );
        const row = rows[0];
        // An unclaimed project belongs to no workspace, so nobody's membership
        // reaches it. Adopting one goes through a claim grant, not through
        // authorization.
        if (row === undefined || row.workspace_id === null) return null;
        return { workspace: WorkspaceId(row.workspace_id), project: ProjectId(row.id) };
      }
      case "dashboard": {
        const { rows } = await pool.query<{ workspace_id: string }>(
          `SELECT workspace_id FROM dashboards WHERE id = $1`,
          [resource.id],
        );
        const row = rows[0];
        // A dashboard may span projects, so it places at the workspace.
        return row === undefined ? null : { workspace: WorkspaceId(row.workspace_id), project: null };
      }
      case "monitor": {
        const { rows } = await pool.query<{ project_id: string; workspace_id: string | null }>(
          `SELECT m.project_id, p.workspace_id
             FROM monitors m JOIN projects p ON p.id = m.project_id
            WHERE m.id = $1`,
          [resource.id],
        );
        const row = rows[0];
        if (row === undefined || row.workspace_id === null) return null;
        return { workspace: WorkspaceId(row.workspace_id), project: ProjectId(row.project_id) };
      }
      case "credential": {
        const { rows } = await pool.query<{ project_id: string; workspace_id: string | null }>(
          `SELECT c.project_id, p.workspace_id
             FROM credentials c JOIN projects p ON p.id = c.project_id
            WHERE c.id = $1`,
          [resource.id],
        );
        const row = rows[0];
        if (row === undefined || row.workspace_id === null) return null;
        return { workspace: WorkspaceId(row.workspace_id), project: ProjectId(row.project_id) };
      }
    }
  },

  async roleOf(account: AccountId, workspace: WorkspaceId): Promise<Role | null> {
    const { rows } = await pool.query<{ role: string }>(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND account_id = $2`,
      [workspace, account],
    );
    const row = rows[0];
    // An unrecognised role is not a role. A typo in the column must not be
    // read as authority, and it must not crash the request either.
    return row !== undefined && isRole(row.role) ? row.role : null;
  },
});
