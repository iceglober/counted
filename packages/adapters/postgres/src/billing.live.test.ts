/**
 * Subscription persistence and webhook idempotency, against a real database.
 *
 * The first test is the whole point of this file: a first-time subscriber has
 * no row, and the write must create one. v1 ran an UPDATE here, matched zero
 * rows, reported success, and left a paying customer on the free plan.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { Instant, Subscription, WorkspaceId, applyBillingEvent } from "@counted/domain";
import { createDatabase, type LiveDatabase } from "./testing/database";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import { CONTROL_PLANE_STATEMENTS } from "./sql/control-plane";
import { createSubscriptionRepository, createWebhookLedger } from "./billing";

const DB = "counted_v2_billing";
const WS = WorkspaceId("22222222-2222-2222-2222-222222222222");
const t0 = Instant.fromEpochMillis(Date.parse("2026-03-17T15:00:00.000Z"));
const renews = Instant.fromEpochMillis(Date.parse("2026-04-17T15:00:00.000Z"));

let pool: Pool | null = null;
let live: LiveDatabase | null = null;
let subscriptions: ReturnType<typeof createSubscriptionRepository> | null = null;
let ledger: ReturnType<typeof createWebhookLedger> | null = null;
let reachable = false;
let reason = "";

const dbTest = (name: string, fn: () => Promise<void>): void =>
  test(name, async () => {
    if (!reachable) {
      if (process.env["REQUIRE_DB"] === "1") throw new Error(`REQUIRE_DB=1 but no database: ${reason}`);
      return;
    }
    await fn();
  });

beforeAll(async () => {
  try {
    live = await createDatabase(DB);
    pool = live.pool;
    for (const s of SCHEMA_STATEMENTS) await pool.query(s);
    for (const s of CONTROL_PLANE_STATEMENTS) await pool.query(s);
    subscriptions = createSubscriptionRepository(pool);
    ledger = createWebhookLedger(pool);
    reachable = true;
  } catch (e) {
    reachable = false;
    reason = (e as Error).message;
  }
});

afterAll(async () => {
  if (pool !== null) await pool.end();
  if (live !== null) await live.drop();
});

const clean = async () => {
  await pool!.query("TRUNCATE webhook_events, subscriptions, workspaces CASCADE");
  await pool!.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Acme')`, [WS]);
};

describe("a first-time subscriber gets a row", () => {
  dbTest("saving with no existing row creates one", async () => {
    await clean();
    expect(await subscriptions!.find(WS)).toBeNull();

    const { subscription } = applyBillingEvent(
      Subscription.none(WS, t0),
      { kind: "checkout_completed", plan: "pro", customer: "cus_1", subscription: "sub_1", renewsAt: renews },
      t0,
    );
    await subscriptions!.save(subscription);

    const stored = await subscriptions!.find(WS);
    expect(stored).not.toBeNull();
    expect(stored).toMatchObject({ plan: "pro", payment: "active", customer: "cus_1", subscription: "sub_1" });
  });

  dbTest("the workspace's own columns move with it", async () => {
    // The ingest quota path reads those. Two sources for one number is how v1
    // ended up with three definitions of "is this customer on Pro?".
    const { rows } = await pool!.query<{ plan: string; payment_state: string }>(
      `SELECT plan, payment_state FROM workspaces WHERE id = $1`,
      [WS],
    );
    expect(rows[0]).toEqual({ plan: "pro", payment_state: "active" });
  });

  dbTest("saving twice updates rather than duplicating", async () => {
    const current = (await subscriptions!.find(WS))!;
    await subscriptions!.save({ ...current, payment: "past_due", updatedAt: t0 });

    const { rows } = await pool!.query<{ n: string }>(`SELECT count(*)::text AS n FROM subscriptions`);
    expect(rows[0]!.n).toBe("1");
    expect((await subscriptions!.find(WS))!.payment).toBe("past_due");
  });

  dbTest("the renewal instant round-trips", async () => {
    const stored = (await subscriptions!.find(WS))!;
    expect(stored.renewsAt).toBe(renews);
  });
});

describe("resolving by the provider's own ids", () => {
  dbTest("a subscription is findable by customer and by subscription ref", async () => {
    // Every event after checkout names only Stripe's ids, so these are how a
    // later event finds the workspace it concerns.
    expect((await subscriptions!.findByCustomer("cus_1"))?.workspace).toBe(WS);
    expect((await subscriptions!.findBySubscriptionRef("sub_1"))?.workspace).toBe(WS);
  });

  dbTest("an unknown ref is null, not a crash", async () => {
    expect(await subscriptions!.findByCustomer("cus_nope")).toBeNull();
    expect(await subscriptions!.findBySubscriptionRef("sub_nope")).toBeNull();
  });

  dbTest("an unrecognised plan in the column reads as free", async () => {
    // A typo must not hand out a paid allowance.
    await pool!.query(`UPDATE subscriptions SET plan = 'enterprise-plus' WHERE workspace_id = $1`, [WS]);
    expect((await subscriptions!.find(WS))!.plan).toBe("free");
    await pool!.query(`UPDATE subscriptions SET plan = 'pro' WHERE workspace_id = $1`, [WS]);
  });
});

describe("a webhook is acted on once", () => {
  dbTest("the first claim wins and a retry does not", async () => {
    await clean();
    expect(await ledger!.claim("evt_1", "checkout.session.completed", t0)).toBe(true);
    // Stripe retries for days. Without this, a retried checkout is applied
    // twice — harmless for the transition, not for the message that goes with it.
    expect(await ledger!.claim("evt_1", "checkout.session.completed", t0)).toBe(false);
    expect(await ledger!.claim("evt_2", "checkout.session.completed", t0)).toBe(true);
  });

  dbTest("marking processed records when, and is safe to repeat", async () => {
    await ledger!.markProcessed("evt_1", t0);
    await ledger!.markProcessed("evt_1", t0);
    const { rows } = await pool!.query<{ processed_at: Date | null }>(
      `SELECT processed_at FROM webhook_events WHERE id = $1`,
      ["evt_1"],
    );
    expect(rows[0]!.processed_at).not.toBeNull();
  });

  dbTest("marking an event we never claimed changes nothing", async () => {
    await ledger!.markProcessed("evt_never", t0);
    const { rows } = await pool!.query<{ n: string }>(`SELECT count(*)::text AS n FROM webhook_events`);
    expect(rows[0]!.n).toBe("2");
  });
});
