/**
 * DashboardRepository — the Dashboard aggregate, tiles and share grant
 * included.
 *
 * Type parameters follow the convention described in
 * `@counted/tenancy-ports/workspace-repository`.
 */

import type { DashboardId, DomainEvent, ProjectId, WorkspaceId } from "@counted/kernel";

/** Enough to render a dashboard list without loading every tile. */
export type DashboardSummary = {
  readonly id: DashboardId;
  readonly workspace: WorkspaceId;
  readonly name: string;
  readonly tileCount: number;
  readonly shared: boolean;
  /**
   * Which dashboard opens when the console is given a workspace and no id.
   *
   * On the summary and not only on the aggregate because the console lists
   * before it loads, and because "at most one default per workspace" is a rule
   * about the *set* — v1 tried to state it as a partial unique index scoped to a
   * user while the loader resolved it scoped to a project, and the two never
   * agreed on which dashboard would open.
   */
  readonly isDefault: boolean;
};

export interface DashboardRepository<Dashboard, DashboardEvent extends DomainEvent> {
  find(id: DashboardId): Promise<Dashboard | null>;

  /**
   * Resolve by share digest. The public share page never has an id — it has a
   * token out of a URL, and the digest of that token is what it can look up.
   */
  findByShareDigest(digest: string): Promise<Dashboard | null>;

  /**
   * Workspace-scoped, not project-scoped, because a dashboard's tiles may read
   * from several projects. This is the listing v2 never had, and its absence is
   * why the console could not show a dashboard that spanned two projects.
   */
  listForWorkspace(workspace: WorkspaceId): Promise<readonly DashboardSummary[]>;

  /** Which projects this dashboard's tiles read from. The share grant's binding
   *  is derived from exactly this set — a share link may run the queries the
   *  page it shows needs, and no others. */
  projectsReadBy(dashboard: DashboardId): Promise<readonly ProjectId[]>;

  /**
   * The workspace's default, if it has one.
   *
   * Marking a dashboard default has to clear the previous holder, and an
   * aggregate can only state a fact about itself. Without this the rule is not
   * enforceable and the v1 bug — two dashboards both claiming to be the
   * default, resolved differently by different queries — comes straight back.
   */
  findDefault(workspace: WorkspaceId): Promise<Dashboard | null>;

  save(dashboard: Dashboard, events: readonly DashboardEvent[]): Promise<void>;

  delete(id: DashboardId): Promise<void>;
}
