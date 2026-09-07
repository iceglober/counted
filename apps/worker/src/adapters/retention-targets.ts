/**
 * Enumerating every claimed project with the plan behind it, one page at a
 * time.
 *
 * **This belongs in `@counted/adapter-postgres`.** It is here because this
 * build hands each agent one directory and the worker is the only caller; the
 * hand-off asks for it to be moved, at which point this file becomes a
 * re-export and then a deletion. Nothing else in `apps/worker` writes SQL.
 *
 * Why a new read at all: neither `ProjectRepository` nor `WorkspaceRepository`
 * can enumerate. They answer `find` and `listForWorkspace`, which is right for
 * every request-shaped caller — and a retention sweep has no workspace to start
 * from. Widening one of those ports with a `listAll` that only a worker uses
 * would put an unbounded read in the interface every request handler holds.
 *
 * Paging is by primary key, not by `OFFSET`. A sweep that deletes as it goes
 * shifts every subsequent offset, so an offset walk silently skips rows —
 * exactly the rows it was about to purge. Ordering by `id` and asking for
 * "after the last one I saw" is stable under concurrent writes.
 *
 * Unclaimed projects are excluded by the join: a project awaiting a claim has
 * no workspace, therefore no plan, therefore no retention to enforce. The
 * exclusivity constraint in `schema.ts` is what makes that a one-line `WHERE`
 * rather than a case analysis.
 */

import { ProjectId, WorkspaceId } from "@counted/kernel";
import { isPaymentState, isPlanId } from "@counted/tenancy-domain";
import { RETENTION_INHERIT, retentionPolicy } from "@counted/projects-domain";
import { isOk } from "@counted/kernel";

import type { RetentionPage, RetentionTarget, RetentionTargets } from "../ports";

type Row = {
  readonly id: string;
  readonly workspace_id: string;
  readonly retention_days: number | null;
  readonly plan: string;
  readonly payment_state: string;
};

export interface RetentionQueryable {
  query<R extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

const PAGE = `
  SELECT p.id, p.workspace_id, p.retention_days, w.plan, w.payment_state
    FROM projects p
    JOIN workspaces w ON w.id = p.workspace_id
   WHERE ($1::text IS NULL OR p.id > $1)
   ORDER BY p.id
   LIMIT $2`;

/**
 * A row this process cannot read is skipped, loudly by omission from the
 * count, rather than defaulted.
 *
 * A plan name we do not recognise must not fall back to `free`: free has the
 * shortest retention in the catalogue, so the fallback would delete a paying
 * customer's data because of a typo in an enum. Skipping leaves the rows in
 * place, which is the recoverable direction to be wrong in.
 */
const toTarget = (row: Row): RetentionTarget | null => {
  if (!isPlanId(row.plan) || !isPaymentState(row.payment_state)) return null;

  const days = row.retention_days;
  if (days === null) {
    return {
      project: ProjectId(row.id),
      workspace: WorkspaceId(row.workspace_id),
      plan: row.plan,
      payment: row.payment_state,
      policy: RETENTION_INHERIT,
    };
  }

  const policy = retentionPolicy(days);
  if (!isOk(policy)) return null;

  return {
    project: ProjectId(row.id),
    workspace: WorkspaceId(row.workspace_id),
    plan: row.plan,
    payment: row.payment_state,
    policy: policy.value,
  };
};

export const postgresRetentionTargets = (db: RetentionQueryable): RetentionTargets => ({
  async page(afterProject, limit): Promise<RetentionPage> {
    const { rows } = await db.query<Row>(PAGE, [afterProject, limit]);
    const targets: RetentionTarget[] = [];
    for (const row of rows) {
      const target = toTarget(row);
      if (target !== null) targets.push(target);
    }
    const last = rows[rows.length - 1];
    return {
      targets,
      examined: rows.length,
      // A short page means the table is exhausted, not that this page was
      // unreadable — which is why the cursor comes off the raw rows.
      cursor: rows.length < limit || last === undefined ? null : ProjectId(last.id),
    };
  },
});
