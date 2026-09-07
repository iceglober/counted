/**
 * `SubscriptionRepository` and `WebhookLedger` — the billing side of storage.
 *
 * Both exist because of the same v1 incident. `checkout.session.completed` was
 * handled with `UPDATE subscriptions SET … WHERE user_id = $1`; for every
 * first-time subscriber no row existed, the statement matched nothing, and the
 * handler reported success. The customer paid and got nothing, and the only
 * signal was the absence of one.
 *
 * So: `save` is an upsert and there is no update-shaped method to reach for,
 * and the ledger makes a redelivered event a no-op in the database rather than
 * in an application-level check that races itself.
 */

import type { Instant, WorkspaceId } from "@counted/kernel";
import {
  Subscription,
  isPaymentState,
  isPlanId,
  type PaymentState,
  type PlanId,
} from "@counted/tenancy-domain";
import type { SubscriptionRepository, WebhookLedger } from "@counted/tenancy-ports";
import { decodeText, optionalInstant, optionalTimestamp, instantOf, timestampOf } from "./decode";
import { exec, firstRow, type Queryable } from "./queryable";

type SubscriptionRow = {
  readonly workspace_id: string;
  readonly plan: string;
  readonly payment_state: string;
  readonly customer_ref: string | null;
  readonly subscription_ref: string | null;
  readonly renews_at: Date | null;
  readonly updated_at: Date;
};

const SELECT = `SELECT workspace_id, plan, payment_state, customer_ref, subscription_ref,
                       renews_at, updated_at
                FROM subscriptions`;

export class PostgresSubscriptionRepository implements SubscriptionRepository<Subscription> {
  constructor(private readonly db: Queryable) {}

  find(workspace: WorkspaceId): Promise<Subscription | null> {
    return this.one(`${SELECT} WHERE workspace_id = $1`, [workspace]);
  }

  /**
   * By the provider's customer id, which is how a webhook arrives: Stripe knows
   * `cus_…`, not which workspace that is. Unique in the schema, so this cannot
   * quietly pick one of two.
   */
  findByCustomer(customer: string): Promise<Subscription | null> {
    return this.one(`${SELECT} WHERE customer_ref = $1`, [customer]);
  }

  findBySubscriptionRef(subscription: string): Promise<Subscription | null> {
    return this.one(`${SELECT} WHERE subscription_ref = $1`, [subscription]);
  }

  async save(subscription: Subscription): Promise<void> {
    await exec(
      this.db,
      `INSERT INTO subscriptions
         (workspace_id, plan, payment_state, customer_ref, subscription_ref, renews_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id) DO UPDATE
         SET plan = EXCLUDED.plan,
             payment_state = EXCLUDED.payment_state,
             customer_ref = EXCLUDED.customer_ref,
             subscription_ref = EXCLUDED.subscription_ref,
             renews_at = EXCLUDED.renews_at,
             updated_at = EXCLUDED.updated_at`,
      [
        subscription.workspace,
        subscription.plan,
        subscription.payment,
        subscription.customer,
        subscription.subscription,
        optionalTimestamp(subscription.renewsAt),
        timestampOf(subscription.updatedAt),
      ],
    );
  }

  private async one(text: string, values: unknown[]): Promise<Subscription | null> {
    const row = await firstRow<SubscriptionRow>(this.db, text, values);
    if (row === null) return null;
    const where = { table: "subscriptions", id: row.workspace_id };
    return {
      workspace: row.workspace_id as WorkspaceId,
      plan: decodeText<PlanId>(row.plan, isPlanId, { ...where, column: "plan" }),
      payment: decodeText<PaymentState>(row.payment_state, isPaymentState, {
        ...where,
        column: "payment_state",
      }),
      customer: row.customer_ref,
      subscription: row.subscription_ref,
      renewsAt: optionalInstant(row.renews_at),
      updatedAt: instantOf(row.updated_at),
    };
  }
}

/**
 * Provider webhooks, deduplicated by primary key.
 *
 * `claim` is `INSERT … ON CONFLICT DO NOTHING RETURNING id`: the first delivery
 * inserts and gets a row back, every redelivery conflicts and gets nothing. A
 * `SELECT` followed by an `INSERT` would have a window between them, and
 * webhook redelivery is bursty by nature — the retry usually arrives while the
 * first attempt is still running, which is exactly when that window is open.
 */
export class PostgresWebhookLedger implements WebhookLedger {
  constructor(private readonly db: Queryable) {}

  async claim(id: string, type: string, at: Instant): Promise<boolean> {
    const row = await firstRow<{ id: string }>(
      this.db,
      `INSERT INTO webhook_receipts (id, type, received_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [id, type, timestampOf(at)],
    );
    return row !== null;
  }

  async markProcessed(id: string, at: Instant): Promise<void> {
    await exec(this.db, `UPDATE webhook_receipts SET processed_at = $2 WHERE id = $1`, [
      id,
      timestampOf(at),
    ]);
  }
}
