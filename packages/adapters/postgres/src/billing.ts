/**
 * A workspace's paid standing, and which webhooks we have already acted on.
 *
 * The only write is an upsert. There is deliberately no update-shaped method:
 * that is the shape of v1's bug, where `UPDATE subscriptions … WHERE user_id`
 * matched zero rows for every first-time subscriber, reported success, and
 * left a paying customer on the free plan with no signal anywhere.
 */

import type { Pool } from "pg";
import {
  Instant,
  WorkspaceId,
  type PaymentState,
  type PlanId,
  type Subscription,
} from "@counted/domain";
import type { SubscriptionRepository, WebhookLedger } from "@counted/ports";

type Row = {
  workspace_id: string;
  plan: string;
  payment_state: string;
  customer_ref: string | null;
  subscription_ref: string | null;
  renews_at: Date | null;
  updated_at: Date;
};

const PLANS: readonly string[] = ["free", "pro"];
const PAYMENTS: readonly string[] = ["none", "active", "past_due", "canceled"];

/** An unrecognised value falls back to free. A typo must not grant a plan. */
const readPlan = (raw: string): PlanId => (PLANS.includes(raw) ? (raw as PlanId) : "free");
const readPayment = (raw: string): PaymentState => (PAYMENTS.includes(raw) ? (raw as PaymentState) : "none");

const toSubscription = (row: Row): Subscription => ({
  workspace: WorkspaceId(row.workspace_id),
  plan: readPlan(row.plan),
  payment: readPayment(row.payment_state),
  customer: row.customer_ref,
  subscription: row.subscription_ref,
  renewsAt: row.renews_at === null ? null : Instant.fromEpochMillis(row.renews_at.getTime()),
  updatedAt: Instant.fromEpochMillis(row.updated_at.getTime()),
});

export const createSubscriptionRepository = (pool: Pool): SubscriptionRepository => {
  const one = async (sql: string, params: readonly unknown[]): Promise<Subscription | null> => {
    const { rows } = await pool.query<Row>(sql, [...params]);
    const row = rows[0];
    return row === undefined ? null : toSubscription(row);
  };

  return {
    find: (workspace) => one(`SELECT * FROM subscriptions WHERE workspace_id = $1`, [workspace]),
    // Resolved by the provider's own ids, because a webhook names those and
    // not our workspace id — except at checkout, where metadata carries it.
    findByCustomer: (customer) => one(`SELECT * FROM subscriptions WHERE customer_ref = $1`, [customer]),
    findBySubscriptionRef: (subscription) =>
      one(`SELECT * FROM subscriptions WHERE subscription_ref = $1`, [subscription]),

    async save(subscription: Subscription): Promise<void> {
      await pool.query(
        `INSERT INTO subscriptions
           (workspace_id, plan, payment_state, customer_ref, subscription_ref, renews_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (workspace_id) DO UPDATE SET
           plan = EXCLUDED.plan,
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
          subscription.renewsAt === null ? null : Instant.toDate(subscription.renewsAt),
          Instant.toDate(subscription.updatedAt),
        ],
      );

      // The workspace's own columns are what the ingest quota path reads, so
      // they are updated in the same call. Two sources for one number is how
      // v1 ended up with three definitions of "is this customer on Pro?".
      await pool.query(`UPDATE workspaces SET plan = $2, payment_state = $3 WHERE id = $1`, [
        subscription.workspace,
        subscription.plan,
        subscription.payment,
      ]);
    },
  };
};

export const createWebhookLedger = (pool: Pool): WebhookLedger => ({
  async claim(id: string, type: string, at: Instant): Promise<boolean> {
    // `ON CONFLICT DO NOTHING` plus a rowCount is the whole idempotency check:
    // the first delivery inserts and wins, every retry inserts nothing.
    const { rowCount } = await pool.query(
      `INSERT INTO webhook_events (id, type, received_at) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
      [id, type, Instant.toDate(at)],
    );
    return (rowCount ?? 0) > 0;
  },

  async markProcessed(id: string, at: Instant): Promise<void> {
    await pool.query(`UPDATE webhook_events SET processed_at = $2 WHERE id = $1`, [id, Instant.toDate(at)]);
  },
});
