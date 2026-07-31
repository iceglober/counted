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
import { dashboardRepo, monitorRepo, outboxRepo, projectRepo, workspaceRepo } from "./repositories";

/** Repositories bound to one open transaction. */
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
    claim: (limit) => outboxRepo.claim(client, limit),
    markDispatched: (ids, at) => outboxRepo.markDispatched(client, ids, at),
    pendingCount: () => outboxRepo.pendingCount(client),
  },
});

export class PostgresUnitOfWork {
  constructor(private readonly pool: Pool) {}

  async transact<T>(work: (repos: BoundRepositories) => Promise<T>): Promise<T> {
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
