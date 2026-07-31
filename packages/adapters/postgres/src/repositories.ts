/**
 * Repositories.
 *
 * Each loads and saves a whole aggregate, and `save` takes the aggregate
 * *together with its events* — so persisting state and enqueuing the outbox
 * happen in one transaction or neither does. "The change committed but the
 * notification did not" becomes a recoverable state rather than a lost one.
 *
 * Every method takes the `PoolClient` the unit of work is holding, so a
 * repository cannot quietly open its own connection and escape the
 * transaction. v1 had no such boundary, which is how project deletion ran a
 * raw `pool.query("DELETE FROM events …")` outside the drizzle transaction it
 * appeared to be inside.
 */

import type { PoolClient } from "pg";
import {
  AccountId,
  CredentialDigest,
  CredentialId,
  CredentialPrefix,
  Dashboard,
  DashboardId,
  Instant,
  Membership,
  Monitor,
  MonitorId,
  Project,
  ProjectId,
  Workspace,
  WorkspaceId,
  WorkspaceLimits,
  type Credential,
  type DashboardEvent,
  type MonitorEvent,
  type Ownership,
  type ProjectEvent,
  type Role,
  type Tile,
  type WorkspaceEvent,
} from "@counted/domain";
import type { DomainEventEnvelope } from "@counted/ports";

const instant = (v: Date | null): Instant | null => (v === null ? null : Instant.fromDate(v));

// ── Workspace ────────────────────────────────────────────────────────────────

export const workspaceRepo = {
  async find(client: PoolClient, id: WorkspaceId): Promise<Workspace | null> {
    const rows = (await client.query(`SELECT id, name, plan, payment_state FROM workspaces WHERE id = $1`, [id])).rows;
    const row = rows[0];
    if (row === undefined) return null;

    const members = (
      await client.query(`SELECT account_id, role, since FROM workspace_members WHERE workspace_id = $1`, [id])
    ).rows;
    const projects = (
      await client.query(`SELECT id, name, state FROM projects WHERE workspace_id = $1 ORDER BY created_at`, [id])
    ).rows;

    return Workspace.rehydrate({
      id,
      name: String(row.name),
      memberships: members.map((m) =>
        Membership.create(AccountId(String(m.account_id)), String(m.role) as Role, Instant.fromDate(m.since)),
      ),
      projects: projects.map((p) => ({
        id: ProjectId(String(p.id)),
        name: String(p.name),
        state: String(p.state) === "archived" ? "archived" : "active",
      })),
      // Limits come from the entitlement, resolved by the application from
      // plan + payment state. The workspace enforces them; it does not know
      // what a plan is.
      limits: WorkspaceLimits.UNLIMITED,
    });
  },

  async listForAccount(client: PoolClient, account: AccountId) {
    // A join rather than two queries: the membership row is what makes the
    // workspace visible at all, so fetching workspaces and then filtering
    // would read rows this account may not see.
    const rows = (
      await client.query(
        `SELECT w.id, w.name, m.role
           FROM workspace_members m
           JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.account_id = $1
          ORDER BY w.name, w.id`,
        [account],
      )
    ).rows;
    return rows.map((row) => ({
      id: WorkspaceId(String(row.id)),
      name: String(row.name),
      role: String(row.role) as Role,
    }));
  },

  async save(client: PoolClient, workspace: Workspace, events: readonly WorkspaceEvent[]): Promise<void> {
    const s = workspace.snapshot();
    await client.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [s.id, s.name],
    );

    // Membership is small and fully owned by the aggregate, so replacing it
    // wholesale is simpler and cannot drift from the in-memory state.
    await client.query(`DELETE FROM workspace_members WHERE workspace_id = $1`, [s.id]);
    for (const m of s.memberships) {
      await client.query(
        `INSERT INTO workspace_members (workspace_id, account_id, role, since) VALUES ($1,$2,$3,$4)`,
        [s.id, m.account, m.role, Instant.toDate(m.since)],
      );
    }
    await enqueue(client, events);
  },
};

// ── Project ──────────────────────────────────────────────────────────────────

const toProject = (row: Record<string, unknown>, credentials: readonly Credential[]): Project => {
  const claimDigest = row.claim_digest === null ? null : String(row.claim_digest);
  const claimExpires = instant(row.claim_expires_at as Date | null);

  const ownership: Ownership =
    claimDigest !== null && claimExpires !== null
      ? { state: "unclaimed", grant: { digest: CredentialDigest(claimDigest), expiresAt: claimExpires } }
      : {
          state: "claimed",
          workspace: WorkspaceId(String(row.workspace_id)),
          claimedAt: Instant.fromDate(row.created_at as Date),
        };

  return Project.rehydrate({
    id: ProjectId(String(row.id)),
    name: String(row.name),
    ownership,
    credentials,
  });
};

const loadCredentials = async (client: PoolClient, project: ProjectId): Promise<readonly Credential[]> =>
  (
    await client.query(
      `SELECT id, kind, label, digest, prefix, scopes, issued_at, expires_at, revoked_at
       FROM credentials WHERE project_id = $1 ORDER BY issued_at`,
      [project],
    )
  ).rows.map((c) => ({
    id: CredentialId(String(c.id)),
    kind: String(c.kind) === "service" ? "service" : "ingest",
    label: String(c.label),
    digest: CredentialDigest(String(c.digest)),
    prefix: CredentialPrefix(String(c.prefix)),
    scopes: c.scopes as Credential["scopes"],
    issuedAt: Instant.fromDate(c.issued_at),
    expiresAt: instant(c.expires_at),
    revokedAt: instant(c.revoked_at),
  }));

export const projectRepo = {
  async find(client: PoolClient, id: ProjectId): Promise<Project | null> {
    const row = (await client.query(`SELECT * FROM projects WHERE id = $1`, [id])).rows[0];
    if (row === undefined) return null;
    return toProject(row, await loadCredentials(client, id));
  },

  /** The ingest hot path: resolve a presented digest to its project. */
  async findByCredentialDigest(client: PoolClient, digest: CredentialDigest): Promise<Project | null> {
    const row = (
      await client.query(
        `SELECT p.* FROM projects p JOIN credentials c ON c.project_id = p.id WHERE c.digest = $1`,
        [digest],
      )
    ).rows[0];
    if (row === undefined) return null;
    return toProject(row, await loadCredentials(client, ProjectId(String(row.id))));
  },

  async findByClaimDigest(client: PoolClient, digest: CredentialDigest): Promise<Project | null> {
    const row = (await client.query(`SELECT * FROM projects WHERE claim_digest = $1`, [digest])).rows[0];
    if (row === undefined) return null;
    return toProject(row, await loadCredentials(client, ProjectId(String(row.id))));
  },

  async listForWorkspace(client: PoolClient, workspace: WorkspaceId): Promise<readonly Project[]> {
    const rows = (
      await client.query(`SELECT * FROM projects WHERE workspace_id = $1 ORDER BY created_at, id`, [workspace])
    ).rows;
    // Credentials are loaded per project rather than in one join: a project
    // holds few of them, and a join would make every row of the list carry a
    // copy of the project.
    return Promise.all(rows.map(async (row) => toProject(row, await loadCredentials(client, ProjectId(String(row.id))))));
  },

  async save(client: PoolClient, project: Project, events: readonly ProjectEvent[]): Promise<void> {
    const s = project.snapshot();
    const unclaimed = s.ownership.state === "unclaimed" ? s.ownership.grant : null;

    await client.query(
      `INSERT INTO projects (id, workspace_id, name, claim_digest, claim_expires_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         name = EXCLUDED.name,
         claim_digest = EXCLUDED.claim_digest,
         claim_expires_at = EXCLUDED.claim_expires_at`,
      [
        s.id,
        project.workspace,
        s.name,
        unclaimed?.digest ?? null,
        unclaimed === null ? null : Instant.toDate(unclaimed.expiresAt),
      ],
    );

    for (const c of s.credentials) {
      await client.query(
        `INSERT INTO credentials (id, project_id, kind, label, digest, prefix, scopes, issued_at, expires_at, revoked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           expires_at = EXCLUDED.expires_at,
           revoked_at = EXCLUDED.revoked_at,
           label = EXCLUDED.label`,
        [
          c.id,
          s.id,
          c.kind,
          c.label,
          c.digest,
          c.prefix,
          JSON.stringify(c.scopes),
          Instant.toDate(c.issuedAt),
          c.expiresAt === null ? null : Instant.toDate(c.expiresAt),
          c.revokedAt === null ? null : Instant.toDate(c.revokedAt),
        ],
      );
    }
    await enqueue(client, events);
  },
};

// ── Dashboard ────────────────────────────────────────────────────────────────

export const dashboardRepo = {
  async find(client: PoolClient, id: DashboardId): Promise<Dashboard | null> {
    const row = (await client.query(`SELECT * FROM dashboards WHERE id = $1`, [id])).rows[0];
    return row === undefined ? null : hydrateDashboard(row);
  },

  async findByShareDigest(client: PoolClient, digest: string): Promise<Dashboard | null> {
    const row = (await client.query(`SELECT * FROM dashboards WHERE share_digest = $1`, [digest])).rows[0];
    return row === undefined ? null : hydrateDashboard(row);
  },

  async listForWorkspace(client: PoolClient, workspace: WorkspaceId): Promise<readonly Dashboard[]> {
    const rows = (
      await client.query(
        // Default first, then by name: a list a human reads should open on the
        // one they meant.
        `SELECT * FROM dashboards WHERE workspace_id = $1 ORDER BY is_default DESC, name, id`,
        [workspace],
      )
    ).rows;
    return rows.map(hydrateDashboard);
  },

  async delete(client: PoolClient, id: DashboardId): Promise<void> {
    await client.query(`DELETE FROM dashboards WHERE id = $1`, [id]);
  },

  async save(client: PoolClient, dashboard: Dashboard, events: readonly DashboardEvent[]): Promise<void> {
    const s = dashboard.snapshot();
    await client.query(
      `INSERT INTO dashboards (id, workspace_id, name, is_default, share_digest, share_expires_at, tiles)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         is_default = EXCLUDED.is_default,
         share_digest = EXCLUDED.share_digest,
         share_expires_at = EXCLUDED.share_expires_at,
         tiles = EXCLUDED.tiles`,
      [
        s.id,
        s.workspace,
        s.name,
        s.isDefault,
        s.share?.digest ?? null,
        s.share === null ? null : Instant.toDate(s.share.expiresAt),
        JSON.stringify(s.tiles),
      ],
    );
    await enqueue(client, events);
  },
};

const hydrateDashboard = (row: Record<string, unknown>): Dashboard =>
  Dashboard.rehydrate({
    id: DashboardId(String(row.id)),
    workspace: WorkspaceId(String(row.workspace_id)),
    name: String(row.name),
    tiles: row.tiles as Tile[],
    isDefault: Boolean(row.is_default),
    share:
      row.share_digest === null
        ? null
        : { digest: String(row.share_digest), expiresAt: Instant.fromDate(row.share_expires_at as Date) },
  });

// ── Monitor ──────────────────────────────────────────────────────────────────

export const monitorRepo = {
  async find(client: PoolClient, id: MonitorId): Promise<Monitor | null> {
    const row = (await client.query(`SELECT * FROM monitors WHERE id = $1`, [id])).rows[0];
    return row === undefined ? null : hydrateMonitor(row);
  },

  async listForProject(client: PoolClient, project: ProjectId): Promise<readonly Monitor[]> {
    const rows = (await client.query(`SELECT * FROM monitors WHERE project_id = $1 ORDER BY name, id`, [project])).rows;
    return rows.map(hydrateMonitor);
  },

  async listEnabled(client: PoolClient, limit: number): Promise<readonly Monitor[]> {
    const rows = (await client.query(`SELECT * FROM monitors WHERE enabled ORDER BY id LIMIT $1`, [limit])).rows;
    return rows.map(hydrateMonitor);
  },

  async save(client: PoolClient, monitor: Monitor, events: readonly MonitorEvent[]): Promise<void> {
    const s = monitor.snapshot();
    await client.query(
      `INSERT INTO monitors (id, project_id, name, analysis, threshold, cooldown_ms, channels, enabled, state, last_notified_at, last_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, analysis = EXCLUDED.analysis, threshold = EXCLUDED.threshold,
         cooldown_ms = EXCLUDED.cooldown_ms, channels = EXCLUDED.channels, enabled = EXCLUDED.enabled,
         state = EXCLUDED.state, last_notified_at = EXCLUDED.last_notified_at, last_value = EXCLUDED.last_value`,
      [
        s.id,
        s.project,
        s.name,
        JSON.stringify(s.analysis),
        JSON.stringify(s.threshold),
        s.cooldown,
        JSON.stringify(s.channels),
        s.enabled,
        s.state,
        s.lastNotifiedAt === null ? null : Instant.toDate(s.lastNotifiedAt),
        s.lastValue,
      ],
    );
    await enqueue(client, events);
  },
};

const hydrateMonitor = (row: Record<string, unknown>): Monitor =>
  Monitor.rehydrate({
    id: MonitorId(String(row.id)),
    project: ProjectId(String(row.project_id)),
    name: String(row.name),
    analysis: row.analysis as never,
    threshold: row.threshold as never,
    cooldown: Number(row.cooldown_ms) as never,
    channels: row.channels as never,
    enabled: Boolean(row.enabled),
    state: String(row.state) === "breaching" ? "breaching" : "ok",
    lastNotifiedAt: instant(row.last_notified_at as Date | null),
    lastValue: row.last_value === null ? null : Number(row.last_value),
  });

// ── Outbox ───────────────────────────────────────────────────────────────────

/**
 * Domain events are written on the same connection, inside the same
 * transaction, as the aggregate that produced them. That is the whole point:
 * a rollback takes the events with it.
 */
const enqueue = async (client: PoolClient, events: readonly { kind: string }[]): Promise<void> => {
  for (const event of events) {
    await client.query(
      `INSERT INTO outbox (id, type, payload, occurred_at) VALUES (gen_random_uuid(), $1, $2, now())`,
      [event.kind, JSON.stringify(event)],
    );
  }
};

export const outboxRepo = {
  /**
   * Enqueue directly.
   *
   * Repository saves already write their aggregate's events on the same
   * connection, so this exists for events that belong to no aggregate — a
   * billing transition, say.
   */
  async enqueue(client: PoolClient, events: readonly DomainEventEnvelope[]): Promise<void> {
    for (const event of events) {
      await client.query(
        `INSERT INTO outbox (id, type, payload, occurred_at) VALUES ($1,$2,$3,$4)`,
        [event.id, event.type, JSON.stringify(event.payload), Instant.toDate(event.occurredAt)],
      );
    }
  },

  /** Claim undispatched events for delivery. SKIP LOCKED so replicas do not collide. */
  async claim(client: PoolClient, limit: number): Promise<readonly DomainEventEnvelope[]> {
    const rows = (
      await client.query(
        `SELECT id, type, payload, occurred_at FROM outbox
         WHERE dispatched_at IS NULL
         ORDER BY occurred_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      )
    ).rows;
    return rows.map((r) => ({
      id: String(r.id),
      type: String(r.type),
      occurredAt: Instant.fromDate(r.occurred_at),
      payload: r.payload,
    }));
  },

  /**
   * Record a failed delivery and return the new attempt count.
   *
   * The row stays undispatched, so the next run claims it again. Returning the
   * count lets the caller decide when to stop rather than encoding that policy
   * in SQL.
   */
  async recordFailure(client: PoolClient, id: string, error: string, at: Instant): Promise<number> {
    const { rows } = await client.query<{ attempts: number }>(
      `UPDATE outbox SET attempts = attempts + 1, last_error = $2, last_error_at = $3
        WHERE id = $1
        RETURNING attempts`,
      [id, error, Instant.toDate(at)],
    );
    return rows[0]?.attempts ?? 0;
  },

  async markDispatched(client: PoolClient, ids: readonly string[], at: Instant): Promise<void> {
    if (ids.length === 0) return;
    await client.query(`UPDATE outbox SET dispatched_at = $2 WHERE id = ANY($1::uuid[])`, [
      [...ids],
      Instant.toDate(at),
    ]);
  },

  async pendingCount(client: PoolClient): Promise<number> {
    const row = (await client.query(`SELECT COUNT(*)::int AS n FROM outbox WHERE dispatched_at IS NULL`)).rows[0];
    return Number(row?.n ?? 0);
  },
};
