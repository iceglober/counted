/**
 * IngestQuota — what stops a project writing.
 *
 * Two different refusals, and conflating them is a support ticket:
 *
 *   `PlanExceeded`  the workspace has used its monthly event allowance. The
 *                   answer is to upgrade, and the HTTP status is 402.
 *   `RateLimited`   too many requests too fast. The answer is to back off, and
 *                   the status is 429 with a retry hint.
 *
 * The count is read, not computed here: the domain decides what a plan allows
 * and this port reports where the workspace stands against it.
 */

import type { Duration, Instant, ProjectId, WorkspaceId } from "@counted/kernel";

export type QuotaVerdict =
  | { readonly kind: "Allowed"; readonly remaining: number | null }
  | { readonly kind: "PlanExceeded"; readonly limit: number; readonly used: number }
  | { readonly kind: "RateLimited"; readonly retryAfter: Duration };

export interface IngestQuota {
  /**
   * May this project write `count` more events right now?
   *
   * Asked once per batch, not once per event — the batch is the unit that gets
   * refused, because refusing half of one leaves the client unable to say what
   * landed.
   */
  check(project: ProjectId, count: number, at: Instant): Promise<QuotaVerdict>;

  /** Record newly committed events only. Project identifies provisional usage before a workspace exists. */
  record(workspace: WorkspaceId, count: number, at: Instant, project: ProjectId): Promise<void>;
}
