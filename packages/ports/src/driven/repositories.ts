/**
 * Repositories — one per aggregate, loading and saving whole aggregates.
 *
 * Aggregate-shaped rather than table-shaped. v1 had no repository layer at
 * all: eight modules imported a raw pg.Pool and built SQL strings, and two
 * flows labelled "transactional" were not — project deletion ran a raw
 * pool.query outside the surrounding drizzle transaction, and the dashboard
 * PUT did demote-then-update as two unwrapped statements.
 *
 * `save` takes the aggregate *and its events*, so persisting state and
 * enqueuing the outbox happen in one transaction or neither does.
 */

import type {
  Dashboard,
  DashboardEvent,
  DashboardId,
  Monitor,
  MonitorEvent,
  MonitorId,
  Project,
  ProjectEvent,
  ProjectId,
  Workspace,
  WorkspaceEvent,
  WorkspaceId,
  CredentialDigest,
} from "@counted/domain";

export interface WorkspaceRepository {
  find(id: WorkspaceId): Promise<Workspace | null>;
  save(workspace: Workspace, events: readonly WorkspaceEvent[]): Promise<void>;
}

export interface ProjectRepository {
  find(id: ProjectId): Promise<Project | null>;
  /** Resolve by presented credential digest — the ingest hot path. */
  findByCredentialDigest(digest: CredentialDigest): Promise<Project | null>;
  findByClaimDigest(digest: CredentialDigest): Promise<Project | null>;
  listForWorkspace(workspace: WorkspaceId): Promise<readonly Project[]>;
  save(project: Project, events: readonly ProjectEvent[]): Promise<void>;
}

export interface DashboardRepository {
  find(id: DashboardId): Promise<Dashboard | null>;
  /** Resolve by share digest. The share page never needs an id. */
  findByShareDigest(digest: string): Promise<Dashboard | null>;
  listForWorkspace(workspace: WorkspaceId): Promise<readonly Dashboard[]>;
  save(dashboard: Dashboard, events: readonly DashboardEvent[]): Promise<void>;
  delete(id: DashboardId): Promise<void>;
}

export interface MonitorRepository {
  find(id: MonitorId): Promise<Monitor | null>;
  listForProject(project: ProjectId): Promise<readonly Monitor[]>;
  /** Everything the worker needs to evaluate, in one pass. */
  listEnabled(limit: number): Promise<readonly Monitor[]>;
  save(monitor: Monitor, events: readonly MonitorEvent[]): Promise<void>;
}

/**
 * SchemaCatalog — which event names and properties a project has seen.
 *
 * Its own port because v1 answered this with six parallel queries over the
 * project's entire history on every configurator open, including a
 * `jsonb_each_text` lateral expansion of every property of every row with a
 * regex per value. It needs a maintained catalog, not a live scan.
 */
export interface SchemaCatalog {
  eventNames(project: ProjectId): Promise<readonly string[]>;
  propertyKeys(project: ProjectId): Promise<readonly string[]>;
  numericPropertyKeys(project: ProjectId): Promise<readonly string[]>;
}
