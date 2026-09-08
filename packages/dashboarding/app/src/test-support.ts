/**
 * In-memory doubles for the dashboarding ports.
 *
 * Real implementations of the interfaces, not mocks with recorded calls: a
 * double that only records what it was asked cannot fail the way a repository
 * fails, and the bugs these use cases exist to prevent — a second default
 * dashboard, a share digest resolving to a sibling — are exactly the ones that
 * only show up when the store actually holds state.
 */

import { Instant } from "@counted/kernel";
import type { DashboardId, MonitorId, ProjectId, WorkspaceId } from "@counted/kernel";
import type { Clock, IdGenerator } from "@counted/kernel/ports";
import { Dashboard, Monitor } from "@counted/dashboarding-domain";
import type { DashboardEvent, MonitorEvent } from "@counted/dashboarding-domain";
import type { DashboardSummary, MintedShareToken, ShareTokens } from "@counted/dashboarding-ports";
import type { DashboardRepository, MonitorRepository } from "./ports";

export type Q = { readonly question: string };
export const q = (question: string): Q => ({ question });

export const T0 = Instant.fromEpochMillis(1_700_000_000_000);

export const stepClock = (start: Instant = T0): Clock & { set(at: Instant): void } => {
  let now = start;
  return { now: () => now, set: (at: Instant) => void (now = at) };
};

export const countingIds = (prefix: string): IdGenerator => {
  let n = 0;
  return { next: () => `${prefix}_${++n}` };
};

/** Digest is a pure function of the token, which is what makes lookup possible. */
export const fakeShareTokens = (): ShareTokens => {
  let n = 0;
  return {
    mint: async (): Promise<MintedShareToken> => {
      const token = `tok_${++n}`;
      return { token, digest: `sha256:${token}` };
    },
    digest: async (token: string) => `sha256:${token}`,
  };
};

export class FakeDashboards implements DashboardRepository<Q> {
  readonly saved: { dashboard: DashboardId; events: readonly DashboardEvent[] }[] = [];
  private readonly rows = new Map<DashboardId, Dashboard<Q>>();
  /** Deliberately settable, so the misfiled-digest case can be reproduced. */
  private readonly digests = new Map<string, DashboardId>();

  seed(dashboard: Dashboard<Q>): this {
    this.rows.set(dashboard.id, dashboard);
    return this;
  }

  /** Point a digest at a dashboard that does not hold it — a join gone wrong. */
  misfileDigest(digest: string, dashboard: DashboardId): this {
    this.digests.set(digest, dashboard);
    return this;
  }

  async find(id: DashboardId): Promise<Dashboard<Q> | null> {
    return this.rows.get(id) ?? null;
  }

  async findByShareDigest(digest: string): Promise<Dashboard<Q> | null> {
    const misfiled = this.digests.get(digest);
    if (misfiled !== undefined) return this.rows.get(misfiled) ?? null;
    for (const row of this.rows.values()) {
      if (row.share?.digest === digest) return row;
    }
    return null;
  }

  async findDefault(workspace: WorkspaceId): Promise<Dashboard<Q> | null> {
    for (const row of this.rows.values()) {
      if (row.workspace === workspace && row.isDefault) return row;
    }
    return null;
  }

  async listForWorkspace(workspace: WorkspaceId): Promise<readonly DashboardSummary[]> {
    return [...this.rows.values()]
      .filter((d) => d.workspace === workspace)
      .map((d) => ({
        id: d.id,
        workspace: d.workspace,
        name: d.name,
        tileCount: d.tiles.length,
        shared: d.share !== null,
        isDefault: d.isDefault,
      }));
  }

  async projectsReadBy(dashboard: DashboardId): Promise<readonly ProjectId[]> {
    return this.rows.get(dashboard)?.projects() ?? [];
  }

  async save(dashboard: Dashboard<Q>, events: readonly DashboardEvent[]): Promise<void> {
    this.rows.set(dashboard.id, dashboard);
    this.saved.push({ dashboard: dashboard.id, events });
  }

  async delete(id: DashboardId): Promise<void> {
    this.rows.delete(id);
  }

  /** How many dashboards in this workspace claim to be the default. */
  defaults(workspace: WorkspaceId): number {
    return [...this.rows.values()].filter((d) => d.workspace === workspace && d.isDefault).length;
  }

  get all(): readonly Dashboard<Q>[] {
    return [...this.rows.values()];
  }
}

export class FakeMonitors implements MonitorRepository<Q> {
  readonly saved: { monitor: MonitorId; events: readonly MonitorEvent[] }[] = [];
  private readonly rows = new Map<MonitorId, Monitor<Q>>();

  seed(monitor: Monitor<Q>): this {
    this.rows.set(monitor.id, monitor);
    return this;
  }

  async find(id: MonitorId): Promise<Monitor<Q> | null> {
    return this.rows.get(id) ?? null;
  }

  async listForProject(project: ProjectId): Promise<readonly Monitor<Q>[]> {
    return [...this.rows.values()].filter((m) => m.project === project);
  }

  async listForWorkspace(workspace: WorkspaceId): Promise<readonly Monitor<Q>[]> {
    return [...this.rows.values()].filter((m) => m.workspace === workspace);
  }

  async listEnabled(limit: number): Promise<readonly Monitor<Q>[]> {
    return [...this.rows.values()].filter((m) => m.enabled).slice(0, limit);
  }

  async claimEnabled(limit: number): Promise<readonly Monitor<Q>[]> { return this.listEnabled(limit); }
  async claimDeliveries(): Promise<readonly never[]> { return []; }
  async completeDelivery(): Promise<void> {}
  async failDelivery(): Promise<void> {}

  async save(monitor: Monitor<Q>, events: readonly MonitorEvent[]): Promise<void> {
    this.rows.set(monitor.id, monitor);
    this.saved.push({ monitor: monitor.id, events });
  }

  async delete(id: MonitorId): Promise<void> {
    this.rows.delete(id);
  }

  get count(): number {
    return this.rows.size;
  }
}
