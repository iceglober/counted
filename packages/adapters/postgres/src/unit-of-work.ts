/**
 * The transactional boundary.
 *
 * Every repository method takes the client this holds, so nothing inside a
 * unit of work can quietly open its own connection and escape the
 * transaction. v1 had no such boundary: project deletion ran a raw
 * `pool.query("DELETE FROM events …")` outside the drizzle transaction it
 * appeared to be inside, and the dashboard PUT did demote-default then update
 * as two unwrapped statements.
 *
 * `transact` commits when the callback resolves and rolls back when it throws.
 * There is no third option, and no way to hold the client afterwards.
 */

import type { Pool, PoolClient } from "pg";
import type { Instant } from "@counted/domain";
import type { Repositories, UnitOfWork } from "@counted/ports";
import { dashboardRepo, monitorRepo, outboxRepo, projectRepo, workspaceRepo } from "./repositories";

/**
 * Repositories bound to one open transaction.
 *
 * Declared here *and* checked against the port below. An earlier version was
 * only declared here, and it quietly drifted: the port promised
 * `listForWorkspace` and `delete` that this facade did not expose, so no route
 * could call them and nothing said so until one tried.
 */
export type BoundRepositories = {
  readonly workspaces: {
    find: (id: Parameters<typeof workspaceRepo.find>[1]) => ReturnType<typeof workspaceRepo.find>;
    save: (
      w: Parameters<typeof workspaceRepo.save>[1],
      e: Parameters<typeof workspaceRepo.save>[2],
    ) => Promise<void>;
  };
  readonly projects: {
    find: (id: Parameters<typeof projectRepo.find>[1]) => ReturnType<typeof projectRepo.find>;
    findByCredentialDigest: (
      d: Parameters<typeof projectRepo.findByCredentialDigest>[1],
    ) => ReturnType<typeof projectRepo.findByCredentialDigest>;
    listForWorkspace: (
      w: Parameters<typeof projectRepo.listForWorkspace>[1],
    ) => ReturnType<typeof projectRepo.listForWorkspace>;
    findByClaimDigest: (
      d: Parameters<typeof projectRepo.findByClaimDigest>[1],
    ) => ReturnType<typeof projectRepo.findByClaimDigest>;
    save: (p: Parameters<typeof projectRepo.save>[1], e: Parameters<typeof projectRepo.save>[2]) => Promise<void>;
  };
  readonly dashboards: {
    find: (id: Parameters<typeof dashboardRepo.find>[1]) => ReturnType<typeof dashboardRepo.find>;
    findByShareDigest: (d: string) => ReturnType<typeof dashboardRepo.findByShareDigest>;
    listForWorkspace: (
      w: Parameters<typeof dashboardRepo.listForWorkspace>[1],
    ) => ReturnType<typeof dashboardRepo.listForWorkspace>;
    delete: (id: Parameters<typeof dashboardRepo.delete>[1]) => Promise<void>;
    save: (d: Parameters<typeof dashboardRepo.save>[1], e: Parameters<typeof dashboardRepo.save>[2]) => Promise<void>;
  };
  readonly monitors: {
    find: (id: Parameters<typeof monitorRepo.find>[1]) => ReturnType<typeof monitorRepo.find>;
    listForProject: (
      p: Parameters<typeof monitorRepo.listForProject>[1],
    ) => ReturnType<typeof monitorRepo.listForProject>;
    listEnabled: (limit: number) => ReturnType<typeof monitorRepo.listEnabled>;
    save: (m: Parameters<typeof monitorRepo.save>[1], e: Parameters<typeof monitorRepo.save>[2]) => Promise<void>;
  };
  readonly outbox: {
    enqueue: (events: Parameters<typeof outboxRepo.enqueue>[1]) => Promise<void>;
    claim: (limit: number) => ReturnType<typeof outboxRepo.claim>;
    markDispatched: (ids: readonly string[], at: Instant) => Promise<void>;
    pendingCount: () => Promise<number>;
  };
};

const bind = (client: PoolClient): BoundRepositories => ({
  workspaces: {
    find: (id) => workspaceRepo.find(client, id),
    save: (w, e) => workspaceRepo.save(client, w, e),
  },
  projects: {
    find: (id) => projectRepo.find(client, id),
    findByCredentialDigest: (d) => projectRepo.findByCredentialDigest(client, d),
    findByClaimDigest: (d) => projectRepo.findByClaimDigest(client, d),
    listForWorkspace: (w) => projectRepo.listForWorkspace(client, w),
    save: (p, e) => projectRepo.save(client, p, e),
  },
  dashboards: {
    find: (id) => dashboardRepo.find(client, id),
    findByShareDigest: (d) => dashboardRepo.findByShareDigest(client, d),
    listForWorkspace: (w) => dashboardRepo.listForWorkspace(client, w),
    delete: (id) => dashboardRepo.delete(client, id),
    save: (d, e) => dashboardRepo.save(client, d, e),
  },
  monitors: {
    find: (id) => monitorRepo.find(client, id),
    listForProject: (p) => monitorRepo.listForProject(client, p),
    listEnabled: (limit) => monitorRepo.listEnabled(client, limit),
    save: (m, e) => monitorRepo.save(client, m, e),
  },
  outbox: {
    enqueue: (events) => outboxRepo.enqueue(client, events),
    claim: (limit) => outboxRepo.claim(client, limit),
    markDispatched: (ids, at) => outboxRepo.markDispatched(client, ids, at),
    pendingCount: () => outboxRepo.pendingCount(client),
  },
});

/**
 * Checked, not assumed.
 *
 * `implements UnitOfWork` is what makes the facade and the port impossible to
 * drift apart — a method the port declares and this does not expose is now a
 * compile error rather than a runtime surprise.
 */
export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  async transact<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(bind(client));
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {
        /* the connection may already be unusable; the release below handles it */
      });
      throw e;
    } finally {
      client.release();
    }
  }
}
