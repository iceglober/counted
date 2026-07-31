/**
 * UnitOfWork — one transaction spanning several repositories.
 *
 * Needed because some commands legitimately touch two aggregates: creating a
 * project registers it on the workspace (for the cap) and creates the project
 * with its first credential. Both, or neither.
 *
 * v1 had no such boundary, which is why project deletion ran
 * `pool.query("DELETE FROM events ...")` outside its own drizzle transaction.
 */

import type {
  DashboardRepository,
  MonitorRepository,
  ProjectRepository,
  WorkspaceRepository,
} from "./repositories";
import type { Outbox } from "./services";

export type Repositories = {
  readonly workspaces: WorkspaceRepository;
  readonly projects: ProjectRepository;
  readonly dashboards: DashboardRepository;
  readonly monitors: MonitorRepository;
  readonly outbox: Outbox;
};

export interface UnitOfWork {
  /** Commits when `work` resolves, rolls back when it throws. */
  transact<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
