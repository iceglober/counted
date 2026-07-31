/**
 * Retention, against a real PostgreSQL.
 *
 * This is the file that actually deletes customer data, so the assertions that
 * matter most are about what survives: that a purge scoped to one project
 * leaves every other project alone, and that dropping a month leaves the
 * months either side of it intact.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { Instant, ProjectId, WorkspaceId } from "@counted/domain";
import { createDatabase, type LiveDatabase } from "./testing/database";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import { CONTROL_PLANE_STATEMENTS } from "./sql/control-plane";
import { createPartitionMaintenance } from "./partition-maintenance";
import { createRetentionMaintenance } from "./retention";
import { partitionFor } from "./partitions";

const DB = "counted_v2_retention";
const WS_FREE = WorkspaceId("22222222-2222-2222-2222-222222222222");
const WS_PRO = WorkspaceId("22222222-2222-2222-2222-222222222233");
const PRJ_FREE = ProjectId("33333333-3333-3333-3333-333333333333");
const PRJ_PRO = ProjectId("33333333-3333-3333-3333-333333333344");

let pool: Pool | null = null;
let live: LiveDatabase | null = null;
let retention: ReturnType<typeof createRetentionMaintenance> | null = null;
let partitions: ReturnType<typeof createPartitionMaintenance> | null = null;
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
    retention = createRetentionMaintenance(pool);
    partitions = createPartitionMaintenance(pool);

    await pool.query(`INSERT INTO workspaces (id,name,plan,payment_state) VALUES ($1,'Free','free','none')`, [WS_FREE]);
    await pool.query(`INSERT INTO workspaces (id,name,plan,payment_state) VALUES ($1,'Pro','pro','active')`, [WS_PRO]);
    await pool.query(`INSERT INTO projects (id,workspace_id,name) VALUES ($1,$2,'F')`, [PRJ_FREE, WS_FREE]);
    await pool.query(`INSERT INTO projects (id,workspace_id,name) VALUES ($1,$2,'P')`, [PRJ_PRO, WS_PRO]);
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

const at = (iso: string) => Instant.fromEpochMillis(Date.parse(iso));

const seed = async (project: ProjectId, iso: string, key: string) => {
  await partitions!.create(partitionFor(at(iso)));
  await pool!.query(
    `INSERT INTO events (project_id, occurred_at, name, visit_id, idempotency_key)
     VALUES ($1,$2,'page_view','v1',$3)`,
    [project, iso, key],
  );
};

const count = async (project: ProjectId): Promise<number> => {
  const { rows } = await pool!.query<{ n: string }>(`SELECT count(*)::text AS n FROM events WHERE project_id = $1`, [
    project,
  ]);
  return Number(rows[0]!.n);
};

const reset = async () => {
  for (const spec of await partitions!.list()) await pool!.query(`DROP TABLE IF EXISTS ${spec.name}`);
  await pool!.query(`TRUNCATE ONLY events_default`);
};

describe("a purge deletes one project's history and nothing else", () => {
  dbTest("only the named project loses rows", async () => {
    await reset();
    await seed(PRJ_FREE, "2024-01-15T00:00:00Z", "free-old");
    await seed(PRJ_PRO, "2024-01-15T00:00:00Z", "pro-old");

    const deleted = await retention!.purgeProject(PRJ_FREE, at("2025-01-01T00:00:00Z"), 1_000);
    expect(deleted).toBe(1);
    expect(await count(PRJ_FREE)).toBe(0);
    // The paying customer's row is in the same partition and untouched.
    expect(await count(PRJ_PRO)).toBe(1);
  });

  dbTest("rows newer than the cutoff survive", async () => {
    await reset();
    await seed(PRJ_FREE, "2024-01-15T00:00:00Z", "old");
    await seed(PRJ_FREE, "2026-01-15T00:00:00Z", "recent");

    await retention!.purgeProject(PRJ_FREE, at("2025-01-01T00:00:00Z"), 1_000);
    const { rows } = await pool!.query<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM events WHERE project_id = $1`,
      [PRJ_FREE],
    );
    expect(rows.map((r) => r.idempotency_key)).toEqual(["recent"]);
  });

  dbTest("a purge across many partitions never reaches a newer one", async () => {
    // The regression. `ctid` is unique within a table, and a partitioned table
    // is many tables — each partition has its own ctid space. Selecting ctids
    // of old rows and deleting by them through the parent matched rows in
    // *other* partitions at the same physical address, deleting live data.
    //
    // Seeded so several old partitions and several new ones each hold rows at
    // low ctids, which is what makes the collision near-certain rather than
    // lucky.
    await reset();
    const old = ["2023-01", "2023-02", "2023-03", "2023-04"];
    const recent = ["2026-01", "2026-02", "2026-03", "2026-04"];
    for (const month of old) await seed(PRJ_FREE, `${month}-10T00:00:00Z`, `old-${month}`);
    for (const month of recent) await seed(PRJ_FREE, `${month}-10T00:00:00Z`, `new-${month}`);

    const deleted = await retention!.purgeProject(PRJ_FREE, at("2025-01-01T00:00:00Z"), 1_000);
    expect(deleted).toBe(old.length);

    const { rows } = await pool!.query<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM events WHERE project_id = $1 ORDER BY occurred_at`,
      [PRJ_FREE],
    );
    // Every recent row survives, and nothing old is left.
    expect(rows.map((r) => r.idempotency_key)).toEqual(recent.map((m) => `new-${m}`));
  });

  dbTest("a row exactly on the cutoff survives", async () => {
    // The comparison is strictly less-than. An event at the boundary is inside
    // the retention window, and deleting it would be an off-by-one nobody can
    // undo.
    await reset();
    await seed(PRJ_FREE, "2025-01-01T00:00:00Z", "boundary");
    expect(await retention!.purgeProject(PRJ_FREE, at("2025-01-01T00:00:00Z"), 1_000)).toBe(0);
    expect(await count(PRJ_FREE)).toBe(1);
  });

  dbTest("the batch bounds the deletion", async () => {
    await reset();
    for (let i = 0; i < 10; i++) await seed(PRJ_FREE, "2024-02-0" + ((i % 9) + 1) + "T00:00:00Z", `b${i}`);
    expect(await retention!.purgeProject(PRJ_FREE, at("2025-01-01T00:00:00Z"), 4)).toBe(4);
    expect(await count(PRJ_FREE)).toBe(6);
  });

  dbTest("purging with nothing to delete is zero, not an error", async () => {
    await reset();
    expect(await retention!.purgeProject(PRJ_FREE, at("2020-01-01T00:00:00Z"), 100)).toBe(0);
  });
});

describe("dropping a month", () => {
  dbTest("removes that month and leaves its neighbours", async () => {
    await reset();
    await seed(PRJ_FREE, "2024-01-15T00:00:00Z", "jan");
    await seed(PRJ_FREE, "2024-02-15T00:00:00Z", "feb");
    await seed(PRJ_FREE, "2024-03-15T00:00:00Z", "mar");

    await retention!.dropPartition("events_2024_02");

    const { rows } = await pool!.query<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM events WHERE project_id = $1 ORDER BY occurred_at`,
      [PRJ_FREE],
    );
    expect(rows.map((r) => r.idempotency_key)).toEqual(["jan", "mar"]);
  });

  dbTest("dropping a partition that is already gone is not an error", async () => {
    // The lease guarantees this job runs twice eventually.
    await retention!.dropPartition("events_2024_02");
  });

  dbTest("anything that is not a month partition is refused", async () => {
    // The name is an identifier and cannot be parameterised, so the shape is
    // checked instead. Nothing a caller supplies should reach this, and if it
    // does it must not run.
    for (const name of ["events", "events_default", "workspaces", "events_2024_02; DROP TABLE workspaces"]) {
      await expect(retention!.dropPartition(name)).rejects.toThrow(/refusing to drop/);
    }
    // The table that a successful injection would have removed is still there.
    const { rows } = await pool!.query<{ n: string }>(`SELECT count(*)::text AS n FROM workspaces`);
    expect(Number(rows[0]!.n)).toBe(2);
  });
});

describe("reading each project's governing plan", () => {
  dbTest("a project reports its workspace's plan and payment state", async () => {
    const listed = await retention!.projectsWithPlans();
    const free = listed.find((r) => r.project === PRJ_FREE);
    const pro = listed.find((r) => r.project === PRJ_PRO);
    expect(free).toMatchObject({ plan: "free", payment: "none" });
    expect(pro).toMatchObject({ plan: "pro", payment: "active" });
  });

  dbTest("an unclaimed project reports the free plan", async () => {
    // No workspace, so no entitlement — the same free allowance it gets for
    // ingestion, rather than an absence the caller has to interpret.
    const unclaimed = ProjectId("33333333-3333-3333-3333-333333333399");
    await pool!.query(`INSERT INTO projects (id,workspace_id,name) VALUES ($1,NULL,'U')`, [unclaimed]);
    const listed = await retention!.projectsWithPlans();
    expect(listed.find((r) => r.project === unclaimed)).toMatchObject({ plan: "free", payment: "none" });
  });

  dbTest("a plan we do not recognise comes back verbatim, not coerced", async () => {
    // The caller decides what to do with it — and for retention the answer is
    // "skip and report", because coercing to free would delete data sooner.
    await pool!.query(`UPDATE workspaces SET plan = 'enterprise-plus' WHERE id = $1`, [WS_PRO]);
    const listed = await retention!.projectsWithPlans();
    expect(listed.find((r) => r.project === PRJ_PRO)?.plan).toBe("enterprise-plus");
    await pool!.query(`UPDATE workspaces SET plan = 'pro' WHERE id = $1`, [WS_PRO]);
  });
});
