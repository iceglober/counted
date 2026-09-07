/**
 * UnitOfWork — one transaction spanning several repositories.
 *
 * Needed because some commands legitimately touch two aggregates. Creating a
 * project registers it against the workspace's project cap and creates the
 * project with its first credential; creating a workspace writes better-auth's
 * organization row and the domain's workspace row. Both, or neither.
 *
 * v1 had no such boundary, which is why project deletion ran
 * `pool.query("DELETE FROM events ...")` outside its own surrounding
 * transaction. v3 removes the excuse: better-auth, the domain and litics share
 * one Postgres — three schemas, one connection — so "in the same transaction"
 * is always available.
 *
 * **Why it is generic.** The bundle of repositories a transaction hands you is
 * decided by the composition root, which is the only place that knows which
 * contexts are deployed together. Naming them here would make this package
 * depend on every context in the system to describe a concept that depends on
 * none of them.
 *
 *     type Repos = {
 *       readonly workspaces: WorkspaceRepository<Workspace, WorkspaceEvent>
 *       readonly projects: ProjectRepository<Project, ProjectEvent>
 *       readonly outbox: Outbox
 *     }
 *     const uow: UnitOfWork<Repos> = postgresUnitOfWork(pool)
 */

export interface UnitOfWork<Repositories> {
  /**
   * Commits when `work` resolves, rolls back when it throws or rejects.
   *
   * A `Result` returned from `work` is a *successful* transaction reporting a
   * refused domain rule — it commits. If a rule violation must roll back, the
   * caller throws. That distinction is deliberate: most refusals happen before
   * anything is written, and treating every Err as a rollback would make the
   * outbox row a use case writes alongside a partial success disappear.
   */
  transact<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
