/**
 * `WorkspaceRepository` over Postgres.
 *
 * **The project register is derived, not stored.** `Workspace` carries a list
 * of `ProjectEntry` and uses it to enforce the project cap; the `projects`
 * table carries the same three facts — id, name, active-or-archived. Writing
 * both would be two records of one number, which is precisely the defect
 * `project-count.ts` was written to close: v2 checked the cap against active
 * projects and loaded the register with no state filter, so a workspace could
 * be simultaneously at 3/3 (may not create another) and at 5/3 (already over)
 * with no code path able to report both. Here `find` builds the register with
 * a `SELECT` over the project rows, so the count the cap sees and the count the
 * usage bar sees are the same query.
 *
 * What that costs: `save` persists the workspace's own columns and nothing
 * else. `registerProject` and `archiveProject` are *decisions* the workspace
 * makes — the row that records them is the project's, written by
 * `ProjectRepository` in the same transaction. The composition root already
 * has to do both (V3-SPEC, `reserveProjectSlot` takes repositories rather than
 * a unit of work for exactly this reason); if it does only the tenancy half,
 * the change is visibly lost rather than invisibly duplicated.
 *
 * **`find` locks inside a transaction.** The cap is a read-then-write: count
 * the projects, decide, insert. Two concurrent creations that both read "2 of
 * 3" both proceed, and the plan limit is advisory rather than enforced. A
 * `SELECT … FOR UPDATE` on the workspace row makes every write to a workspace
 * queue behind every other, which is the smallest thing that makes the cap
 * true. Outside a transaction the lock would be released by the next statement,
 * so it is not taken — a pooled read stays a pooled read.
 */

import type { AccountId, Role, WorkspaceId } from "@counted/kernel";
import { Workspace, isPaymentState, isPlanId, type PaymentState, type PlanId, type ProjectEntry, type WorkspaceEvent } from "@counted/tenancy-domain";
import type { WorkspaceRepository, WorkspaceSummary } from "@counted/tenancy-ports";
import { decodeText } from "./decode";
import type { WorkspaceMemberships } from "./memberships";
import { exec, firstRow, rows, type Queryable } from "./queryable";
import type { TenancyTree } from "./tenancy-tree";

type WorkspaceRow = {
  readonly id: string;
  readonly name: string;
  readonly plan: string;
  readonly payment_state: string;
};

type RegisterRow = {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
};

export type WorkspaceRepositoryOptions = {
  readonly memberships: WorkspaceMemberships;
  /** True when this repository is bound to a client inside `BEGIN … COMMIT`. */
  readonly locking: boolean;
  /** Where the analytics engine learns this workspace exists. See `tenancy-tree.ts`. */
  readonly tenancy: TenancyTree;
};

export class PostgresWorkspaceRepository
  implements WorkspaceRepository<Workspace, WorkspaceEvent>
{
  constructor(
    private readonly db: Queryable,
    private readonly options: WorkspaceRepositoryOptions,
  ) {}

  async find(id: WorkspaceId): Promise<Workspace | null> {
    const row = await firstRow<WorkspaceRow>(
      this.db,
      `SELECT id, name, plan, payment_state FROM workspaces WHERE id = $1
       ${this.options.locking ? "FOR UPDATE" : ""}`,
      [id],
    );
    if (row === null) return null;

    return Workspace.rehydrate({
      id,
      name: row.name,
      plan: decodeText<PlanId>(row.plan, isPlanId, {
        table: "workspaces",
        id: row.id,
        column: "plan",
      }),
      payment: decodeText<PaymentState>(row.payment_state, isPaymentState, {
        table: "workspaces",
        id: row.id,
        column: "payment_state",
      }),
      projects: await this.register(id),
    });
  }

  /**
   * The workspaces an account can see, with the role it holds in each.
   *
   * Two round trips and not a join — the membership rows belong to better-auth
   * (see `memberships.ts`). A workspace the account is a member of but which
   * has no row here is dropped rather than invented: better-auth's organization
   * and the domain's workspace share an id and are created together, so the
   * only way to be in that state is a half-finished creation, and rendering a
   * workspace with no plan is worse than not listing it.
   */
  async listForAccount(account: AccountId): Promise<readonly WorkspaceSummary[]> {
    const memberships = await this.options.memberships.forAccount(account);
    if (memberships.length === 0) return [];

    const roles = new Map<string, Role>(memberships.map((m) => [m.workspace, m.role]));
    const found = await rows<{ id: string; name: string }>(
      this.db,
      `SELECT id, name FROM workspaces WHERE id = ANY($1::text[]) ORDER BY name, id`,
      [[...roles.keys()]],
    );

    const summaries: WorkspaceSummary[] = [];
    for (const row of found) {
      const role = roles.get(row.id);
      if (role === undefined) continue;
      summaries.push({ id: row.id as WorkspaceId, name: row.name, role });
    }
    return summaries;
  }

  /**
   * Upsert. There is no update-shaped sibling anywhere in this package, and
   * that is a rule rather than an omission: v1's billing handler ran
   * `UPDATE … WHERE user_id = $1`, matched zero rows for every first-time
   * subscriber, and reported success.
   *
   * `events` is not written here. The outbox is a separate repository handed
   * out by the same transaction, so the use case writes the aggregate and its
   * events side by side and neither one is this class's to guess at.
   */
  async save(workspace: Workspace, events: readonly WorkspaceEvent[]): Promise<void> {
    const snapshot = workspace.snapshot();
    await exec(
      this.db,
      `INSERT INTO workspaces (id, name, plan, payment_state)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             plan = EXCLUDED.plan,
             payment_state = EXCLUDED.payment_state,
             updated_at = now()`,
      [snapshot.id, snapshot.name, snapshot.plan, snapshot.payment],
    );

    /**
     * The workspace is a root of the analytics tenancy tree, and it is written
     * here so it lands in the same transaction as the row above.
     *
     * A project's row references its workspace's, so this has to exist before
     * any project can be placed — which it does, because every path that
     * creates a project reserves its slot first and a reservation saves the
     * workspace.
     */
    const place = this.options.tenancy.place(snapshot.id, null);
    await exec(this.db, place.sql, [...place.parameters]);
  }

  private async register(workspace: WorkspaceId): Promise<readonly ProjectEntry[]> {
    const found = await rows<RegisterRow>(
      this.db,
      `SELECT id, name, archived FROM projects
       WHERE workspace_id = $1
       ORDER BY created_at, id`,
      [workspace],
    );
    return found.map((row) => ({
      id: row.id as ProjectEntry["id"],
      name: row.name,
      state: row.archived ? "archived" : "active",
    }));
  }
}
