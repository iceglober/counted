import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { Duration, Instant, MonitorId } from "@counted/kernel";
import type { MonitorAlert } from "@counted/dashboarding-domain";
import { Pool } from "pg";
import { PostgresMonitorRepository } from "./monitor-repository";
import { applySchema, DOMAIN_MIGRATIONS } from "./schema";
import { describeLive } from "./testing";

const ADMIN_URL = process.env.COUNTED_TEST_DATABASE_URL ?? "postgres://counted:counted@127.0.0.1:5434/counted";
const DATABASE = "counted_monitor_upgrade_test";
const UPGRADE = "domain-004-monitor-delivery-upgrade";
const at = Instant.fromEpochMillis(Date.parse("2026-09-07T12:00:00Z"));

// Historical DDL, intentionally independent of the current domain-002 body.
// Its name was already ledgered on databases whose queue lacks canceled_at.
const legacyMonitorStep = {
  name: "domain-002-monitor-reliability",
  statements: [
    `ALTER TABLE monitors
       ADD COLUMN last_attempt_at timestamptz,
       ADD COLUMN last_measured_at timestamptz,
       ADD COLUMN evaluation_error text,
       ADD COLUMN evaluation_claimed_until timestamptz`,
    `DROP INDEX monitors_due`,
    `CREATE INDEX monitors_due ON monitors (last_attempt_at NULLS FIRST, id) WHERE enabled`,
    `CREATE TABLE monitor_deliveries (
       id text PRIMARY KEY,
       monitor_id text NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
       alert jsonb NOT NULL,
       occurred_at timestamptz NOT NULL,
       next_attempt_at timestamptz NOT NULL,
       claimed_at timestamptz,
       delivered_at timestamptz,
       attempts integer NOT NULL DEFAULT 0,
       last_error text
     )`,
    `CREATE INDEX monitor_deliveries_due ON monitor_deliveries (next_attempt_at, occurred_at, id)
       WHERE delivered_at IS NULL`,
    `CREATE INDEX monitor_deliveries_by_monitor ON monitor_deliveries (monitor_id, occurred_at)`,
  ],
};

describeLive("monitor schema upgrade", () => {
  let pool: Pool;
  beforeAll(async () => {
    const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${DATABASE}`);
      await admin.query(`CREATE DATABASE ${DATABASE}`);
    } finally { await admin.end(); }
    const url = new URL(ADMIN_URL);
    url.pathname = `/${DATABASE}`;
    pool = new Pool({ connectionString: url.toString(), max: 4 });
  });
  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
  });
  afterAll(async () => { await pool?.end(); });

  test("an already-stamped older queue upgrades without losing monitors or pending deliveries", async () => {
    await applySchema(pool, { migrations: DOMAIN_MIGRATIONS.filter(step => step.name !== UPGRADE)
      .map(step => step.name === legacyMonitorStep.name ? legacyMonitorStep : step) });
    await pool.query(`INSERT INTO workspaces (id,name,plan,payment_state) VALUES ('ws','Existing','free','current')`);
    await pool.query(`INSERT INTO projects (id,workspace_id,name,archived,claimed_at) VALUES ('prj','ws','Existing',false,$1)`, [Instant.toISO(at)]);
    await pool.query(`INSERT INTO monitors (id,workspace_id,project_id,name,analysis,threshold_comparison,threshold_value,
      cooldown_ms,channels,enabled,state,last_value,last_attempt_at,last_measured_at)
      VALUES ('mon','ws','prj','Existing monitor','{"metric":"errors"}','above',1,60000,'[]',true,'breaching',7,$1,$1)`, [Instant.toISO(at)]);
    const alert: MonitorAlert = { id: "delivery", monitor: "mon", workspace: "ws", project: "prj",
      name: "Existing monitor", channel: { kind: "email", address: "fixture@example.test" },
      state: "breaching", observed: 7, threshold: { comparison: "above", value: 1 }, occurredAt: Instant.toISO(at) };
    await pool.query(`INSERT INTO monitor_deliveries (id,monitor_id,alert,occurred_at,next_attempt_at,attempts,last_error)
      VALUES ('delivery','mon',$1,$2,$2,2,'prior transport failure')`, [JSON.stringify(alert), Instant.toISO(at)]);
    const previousMonitor = (await pool.query("SELECT * FROM monitors")).rows[0];
    const previousDelivery = (await pool.query("SELECT * FROM monitor_deliveries")).rows[0];
    const previousLedger = (await pool.query("SELECT * FROM schema_migrations ORDER BY name")).rows;
    const repository = new PostgresMonitorRepository(pool, { encode: (value: unknown) => value, decode: (value: unknown) => value });
    await expect(repository.find(MonitorId("mon"))).rejects.toThrow("canceled_at");

    const upgraded = await applySchema(pool);
    expect(upgraded.applied).toEqual([UPGRADE]);
    expect((await pool.query("SELECT * FROM schema_migrations WHERE name <> $1 ORDER BY name", [UPGRADE])).rows).toEqual(previousLedger);
    expect((await pool.query("SELECT * FROM monitors")).rows[0]).toEqual(previousMonitor);
    expect((await pool.query("SELECT * FROM monitor_deliveries")).rows[0]).toEqual({ ...previousDelivery, canceled_at: null });
    const loaded = await repository.find(MonitorId("mon"));
    expect(loaded?.lastValue).toBe(7);
    expect(loaded?.pendingDeliveries).toBe(1);
    expect(loaded?.deliveryError).toBe("prior transport failure");
    const [delivery] = await repository.claimDeliveries(1, at);
    expect(delivery?.alert).toEqual(alert);
    expect(delivery?.attempts).toBe(3);
    const disabled = loaded!.disable(at);
    if (!disabled.ok) throw new Error(disabled.error.kind);
    await repository.save(disabled.value.monitor, disabled.value.events);
    expect(await repository.claimDeliveries(1, Instant.plus(at, Duration.minutes(10)))).toEqual([]);
    expect((await pool.query("SELECT canceled_at FROM monitor_deliveries WHERE id='delivery'")).rows[0].canceled_at).not.toBeNull();
    expect((await applySchema(pool)).applied).toEqual([]);
  });

  test("earlier health and lease variants receive missing columns and corrected indexes", async () => {
    await applySchema(pool, { migrations: DOMAIN_MIGRATIONS.filter(step => step.name !== UPGRADE) });
    await pool.query("DROP INDEX monitors_due");
    await pool.query("CREATE INDEX monitors_due ON monitors(last_notified_at NULLS FIRST,id) WHERE enabled");
    await pool.query("ALTER TABLE monitors DROP COLUMN last_attempt_at, DROP COLUMN last_measured_at, DROP COLUMN evaluation_error, DROP COLUMN evaluation_claimed_until");
    await pool.query("ALTER TABLE monitor_deliveries DROP COLUMN claimed_at, DROP COLUMN canceled_at");
    await applySchema(pool);
    const columns = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public'
      AND table_name IN ('monitors','monitor_deliveries')`)).rows.map(row => row.column_name);
    for (const column of ["last_attempt_at", "last_measured_at", "evaluation_error", "evaluation_claimed_until", "claimed_at", "canceled_at"]) expect(columns).toContain(column);
    const indexes = (await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'")).rows;
    expect(indexes.find(row => row.indexname === "monitors_due").indexdef).toContain("last_attempt_at NULLS FIRST");
    expect(indexes.find(row => row.indexname === "monitor_deliveries_due").indexdef).toContain("canceled_at IS NULL");
    // Repair statements themselves remain safe if a deployment already has a
    // complete schema, independently of the ledger's repeat-boot protection.
    for (const statement of DOMAIN_MIGRATIONS.find(step => step.name === UPGRADE)!.statements) await pool.query(statement);
  });

  test("fresh and repeated boots both converge on the complete monitor schema", async () => {
    expect((await applySchema(pool)).applied).toEqual(DOMAIN_MIGRATIONS.map(step => step.name));
    const repository = new PostgresMonitorRepository(pool, { encode: (value: unknown) => value, decode: (value: unknown) => value });
    expect(await repository.claimEnabled(1, at)).toEqual([]);
    expect(await repository.claimDeliveries(1, at)).toEqual([]);
    expect((await applySchema(pool)).applied).toEqual([]);
  });
});
