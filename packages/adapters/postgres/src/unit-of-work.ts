/**
 * One transaction, one set of repositories, one connection.
 *
 * `UnitOfWork` is generic in the repository bundle because the bundle is chosen
 * by the composition root — the only place that knows which contexts are
 * deployed together. `CountedRepositories` is the bundle for a deployment that
 * runs all of them, which today is every deployment.
 *
 * The whole reason this type exists is that some commands legitimately touch
 * two aggregates: creating a project registers it against the workspace's cap
 * *and* creates the project, and the tenancy and projects packages may not
 * import each other, so the two halves are composed here inside one `transact`.
 * v1 had no such boundary, which is why project deletion ran its `DELETE FROM
 * events` on the pool while a transaction was open on another connection — the
 * rollback that was supposed to protect it rolled back nothing.
 *
 * **Nesting is not supported and does not silently half-work.** A `transact`
 * called inside another `transact` would need a savepoint to mean anything, and
 * without one the inner `COMMIT` would end the outer transaction early. Since
 * the repositories are only reachable through the callback, the only way to
 * nest is to close over the unit of work itself, which a use case has no reason
 * to do.
 */

import type { Dashboard, DashboardEvent, Monitor, MonitorEvent } from "@counted/dashboarding-domain";
import type { DashboardRepository, MonitorRepository } from "@counted/dashboarding-ports";
import type { Outbox, UnitOfWork } from "@counted/persistence-ports";
import type { Project, ProjectEvent } from "@counted/projects-domain";
import type { ProjectRepository } from "@counted/projects-ports";
import type { Subscription, Workspace, WorkspaceEvent } from "@counted/tenancy-domain";
import type {
  SubscriptionRepository,
  WebhookLedger,
  WorkspaceRepository,
} from "@counted/tenancy-ports";
import type { Pool } from "pg";

import type { AnalysisCodec } from "./decode";
import { PostgresDashboardRepository } from "./dashboard-repository";
import type { WorkspaceMemberships } from "./memberships";
import { PostgresMonitorRepository } from "./monitor-repository";
import { PostgresOutbox, type OutboxOptions } from "./outbox";
import { PostgresProjectRepository } from "./project-repository";
import {
  PostgresSubscriptionRepository,
  PostgresWebhookLedger,
} from "./subscription-repository";
import type { Queryable } from "./queryable";
import type { TenancyTree } from "./tenancy-tree";
import { PostgresWorkspaceRepository } from "./workspace-repository";

/**
 * Every repository a command can reach, closed over `A` — the analytics
 * context's Analysis IR, which stays a type parameter until the composition
 * root (V3-SPEC §7).
 */
export type CountedRepositories<A> = {
  readonly workspaces: WorkspaceRepository<Workspace, WorkspaceEvent>;
  readonly subscriptions: SubscriptionRepository<Subscription>;
  readonly webhooks: WebhookLedger;
  readonly projects: ProjectRepository<Project, ProjectEvent>;
  readonly dashboards: DashboardRepository<Dashboard<A>, DashboardEvent>;
  readonly monitors: MonitorRepository<Monitor<A>, MonitorEvent>;
  readonly outbox: Outbox;
};

export type PostgresAdapterOptions<A> = {
  /** How an opaque analysis becomes jsonb and back. See `decode.ts`. */
  readonly analysis: AnalysisCodec<A>;
  /** Where `listForAccount` gets its roles. See `memberships.ts`. */
  readonly memberships: WorkspaceMemberships;
  /**
   * How a workspace and a project are recorded in the analytics engine's
   * tenancy tree. Required, not optional: a deployment that leaves it out
   * answers every analytics question with zero and reports no error, so the
   * choice is made explicitly — `noTenancyTree` when there is genuinely
   * nothing to tell. See `tenancy-tree.ts`.
   */
  readonly tenancy: TenancyTree;
  readonly outbox?: OutboxOptions;
};

/**
 * Repositories bound to whatever you hand them.
 *
 * `locking` is the one behaviour that differs between a pooled read and a
 * transactional write: inside a transaction, loading a workspace takes a row
 * lock so the project cap's read-then-write cannot interleave with another
 * one's. On a pool that lock would be released by the next statement, so it is
 * not taken — see `workspace-repository.ts`.
 */
export const postgresRepositories = <A>(
  db: Queryable,
  options: PostgresAdapterOptions<A>,
  locking: boolean,
): CountedRepositories<A> => ({
  workspaces: new PostgresWorkspaceRepository(db, {
    memberships: options.memberships,
    locking,
    tenancy: options.tenancy,
  }),
  subscriptions: new PostgresSubscriptionRepository(db),
  webhooks: new PostgresWebhookLedger(db),
  projects: new PostgresProjectRepository(db, options.tenancy),
  dashboards: new PostgresDashboardRepository<A>(db, options.analysis),
  monitors: new PostgresMonitorRepository<A>(db, options.analysis),
  outbox: new PostgresOutbox(db, options.outbox ?? {}),
});

/**
 * Read-only-ish repositories on the pool, for the reads that are not part of a
 * command. They write perfectly well; what they do not have is a transaction,
 * so two writes through them are two transactions.
 */
export const pooledRepositories = <A>(
  pool: Pool,
  options: PostgresAdapterOptions<A>,
): CountedRepositories<A> => postgresRepositories(pool, options, false);

export const postgresUnitOfWork = <A>(
  pool: Pool,
  options: PostgresAdapterOptions<A>,
): UnitOfWork<CountedRepositories<A>> => ({
  async transact<T>(work: (repositories: CountedRepositories<A>) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // A Result returned from `work` is a successful transaction reporting a
      // refused rule, and it commits (V3-SPEC §5). Only a throw rolls back.
      const result = await work(postgresRepositories(client, options, true));
      await client.query("COMMIT");
      return result;
    } catch (cause) {
      // If the ROLLBACK itself fails the connection is already unusable; the
      // original error is the one worth propagating, so this one is swallowed
      // deliberately rather than by omission.
      await client.query("ROLLBACK").catch(() => undefined);
      throw cause;
    } finally {
      client.release();
    }
  },
});
