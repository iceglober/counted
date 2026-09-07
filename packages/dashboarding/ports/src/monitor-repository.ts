/**
 * MonitorRepository — standing thresholds over an Analysis.
 *
 * Type parameters follow the convention described in
 * `@counted/tenancy-ports/workspace-repository`.
 */

import type { DomainEvent, Instant, MonitorId, ProjectId, WorkspaceId } from "@counted/kernel";
import type { MonitorAlert } from "@counted/dashboarding-domain";

export interface MonitorRepository<Monitor, MonitorEvent extends DomainEvent> {
  find(id: MonitorId): Promise<Monitor | null>;

  listForProject(project: ProjectId): Promise<readonly Monitor[]>;

  listForWorkspace(workspace: WorkspaceId): Promise<readonly Monitor[]>;

  /**
   * Everything the worker needs to evaluate, in one pass.
   *
   * `limit` is a batch size, not a filter: the worker takes a slice, evaluates
   * it, and comes back. A single unbounded query here is how a thousand
   * monitors turn one evaluation tick into a timeout.
   */
  listEnabled(limit: number): Promise<readonly Monitor[]>;

  /** Claim the least recently attempted monitors. Leases expire after a crashed worker. */
  claimEnabled(limit: number, at: Instant, exclude?: readonly MonitorId[]): Promise<readonly Monitor[]>;

  claimDeliveries(limit: number, at: Instant): Promise<readonly MonitorDelivery[]>;
  completeDelivery(delivery: MonitorDelivery, at: Instant): Promise<void>;
  failDelivery(delivery: MonitorDelivery, error: string, at: Instant): Promise<void>;

  save(monitor: Monitor, events: readonly MonitorEvent[]): Promise<void>;

  delete(id: MonitorId): Promise<void>;
}

export type MonitorDelivery = {
  readonly alert: MonitorAlert;
  readonly attempts: number;
  /** Fences completion by a worker whose lease has expired. */
  readonly claimedAt: Instant;
};
