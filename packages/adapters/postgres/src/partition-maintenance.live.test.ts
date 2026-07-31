/**
 * Partition maintenance, against a real PostgreSQL.
 *
 * Three claims that only a real database can settle: that listing reads the
 * catalog rather than our memory of it, that creating is genuinely idempotent
 * under a race, and — the one that matters — that draining the default
 * partition actually relocates rows into the month they belong to.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { Instant } from "@counted/domain";
import { createDatabase, type LiveDatabase } from "./testing/database";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import { CONTROL_PLANE_STATEMENTS } from "./sql/control-plane";
import { createPartitionMaintenance, requiredPartitions, DEFAULT_PARTITION } from "./partition-maintenance";
import { partitionFor } from "./partitions";

const DB = "counted_v2_partitions";
const MARCH = Instant.fromEpochMillis(Date.parse("2026-03-17T12:00:00.000Z"));
const PRJ = "33333333-3333-3333-3333-333333333333";

let pool: Pool | null = null;
let live: LiveDatabase | null = null;
let maintenance: ReturnType<typeof createPartitionMaintenance> | null = null;
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
    maintenance = createPartitionMaintenance(pool);
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

/** Drop every month partition, leaving the parent and the default. */
const resetPartitions = async () => {
  for (const spec of await maintenance!.list()) {
    await pool!.query(`DROP TABLE IF EXISTS ${spec.name}`);
  }
  await pool!.query(`TRUNCATE ONLY ${DEFAULT_PARTITION}`);
};

const insertEvent = async (occurredAt: string, key: string) => {
  await pool!.query(
    `INSERT INTO events (project_id, occurred_at, name, visit_id, idempotency_key)
     VALUES ($1, $2, 'page_view', 'v1', $3)`,
    [PRJ, occurredAt, key],
  );
};

describe("listing reads the catalog, not our memory of it", () => {
  dbTest("a fresh table has no month partitions", async () => {
    await resetPartitions();
    expect(await maintenance!.list()).toHaveLength(0);
  });

  dbTest("created partitions appear, with their bounds parsed back", async () => {
    for (const spec of requiredPartitions(MARCH, 2)) await maintenance!.create(spec);
    const listed = await maintenance!.list();
    expect(listed.map((p) => p.name)).toEqual(["events_2026_03", "events_2026_04", "events_2026_05"]);
    // Bounds come from the name, so they can be compared with what is required
    // rather than trusted from a cache.
    expect(listed[0]!.from).toBe(partitionFor(MARCH).from);
  });

  dbTest("the default partition is not listed as a month", async () => {
    // It has no bounds to parse, and treating it as a month would make the
    // job think a month exists that does not.
    expect((await maintenance!.list()).map((p) => p.name)).not.toContain(DEFAULT_PARTITION);
  });

  dbTest("a partition dropped by hand disappears from the list", async () => {
    await pool!.query(`DROP TABLE events_2026_05`);
    expect((await maintenance!.list()).map((p) => p.name)).not.toContain("events_2026_05");
  });
});

describe("creating is safe to repeat", () => {
  dbTest("creating the same partition twice is not an error", async () => {
    // The lease guarantees this job runs twice eventually.
    const spec = partitionFor(MARCH);
    await maintenance!.create(spec);
    await maintenance!.create(spec);
    expect((await maintenance!.list()).filter((p) => p.name === spec.name)).toHaveLength(1);
  });

  dbTest("concurrent creation of the same month does not fail", async () => {
    await resetPartitions();
    const spec = partitionFor(MARCH);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => maintenance!.create(spec)));
    // `CREATE TABLE IF NOT EXISTS` under a race can still raise a duplicate
    // relation error in PostgreSQL; what must not happen is the partition
    // ending up absent.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect((await maintenance!.list()).map((p) => p.name)).toContain(spec.name);
  });

  dbTest("an event in a created month lands in that partition", async () => {
    await insertEvent("2026-03-05T00:00:00Z", "in-march");
    const { rows } = await pool!.query<{ n: string }>(`SELECT count(*)::text AS n FROM ONLY events_2026_03`);
    expect(rows[0]!.n).toBe("1");
  });
});

describe("rescuing rows from the default partition", () => {
  dbTest("an event with no month lands in the default", async () => {
    // This is the failure being recovered from: partition creation fell
    // behind, and the row went somewhere it will never be pruned from.
    await resetPartitions();
    await maintenance!.create(partitionFor(MARCH));
    await insertEvent("2029-07-01T00:00:00Z", "far-future");
    expect(await maintenance!.countDefault()).toBe(1);
  });

  dbTest("draining creates the month it needs and moves it there", async () => {
    // The month cannot be created first: PostgreSQL refuses to attach a
    // partition while the default holds rows belonging to its range. So the
    // drain removes the rows, creates the month, and puts them back.
    expect(await maintenance!.drainDefault(1_000)).toBe(1);
    expect(await maintenance!.countDefault()).toBe(0);

    const { rows } = await pool!.query<{ n: string }>(`SELECT count(*)::text AS n FROM ONLY events_2029_07`);
    expect(rows[0]!.n).toBe("1");
  });

  dbTest("no row is lost or duplicated by the move", async () => {
    const { rows } = await pool!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM events WHERE idempotency_key = 'far-future'`,
    );
    expect(rows[0]!.n).toBe("1");
  });

  dbTest("a row from any month finds a home, however far out", async () => {
    // The drain creates whatever month the row needs, so nothing is left
    // stranded waiting for a partition someone has to think to create.
    await resetPartitions();
    await maintenance!.create(partitionFor(MARCH));
    await insertEvent("2031-01-01T00:00:00Z", "no-home");

    expect(await maintenance!.drainDefault(1_000)).toBe(1);
    expect(await maintenance!.countDefault()).toBe(0);
    expect((await maintenance!.list()).map((p) => p.name)).toContain("events_2031_01");
  });

  dbTest("several stranded months take several runs, one each", async () => {
    await resetPartitions();
    await insertEvent("2032-01-05T00:00:00Z", "m1");
    await insertEvent("2032-02-05T00:00:00Z", "m2");
    await insertEvent("2032-03-05T00:00:00Z", "m3");

    expect(await maintenance!.drainDefault(100)).toBe(1);
    expect(await maintenance!.drainDefault(100)).toBe(1);
    expect(await maintenance!.drainDefault(100)).toBe(1);
    expect(await maintenance!.countDefault()).toBe(0);

    const names = (await maintenance!.list()).map((p) => p.name);
    for (const month of ["events_2032_01", "events_2032_02", "events_2032_03"]) {
      expect(names).toContain(month);
    }
  });

  dbTest("a month moves whole, because a partial move can never finish", async () => {
    // Move half of a month out and creating that month still fails on the half
    // left behind. So the unit is a month, not a row count.
    await resetPartitions();
    await maintenance!.create(partitionFor(MARCH));
    for (let i = 0; i < 10; i++) await insertEvent("2029-08-01T00:00:00Z", `bulk-${i}`);

    expect(await maintenance!.drainDefault(1_000)).toBe(10);
    expect(await maintenance!.countDefault()).toBe(0);
  });

  dbTest("a month past the threshold is refused, not half-moved", async () => {
    // Holding ten million rows in one transaction is not a thing to do
    // silently at three in the morning.
    await resetPartitions();
    for (let i = 0; i < 5; i++) await insertEvent("2029-10-01T00:00:00Z", `big-${i}`);

    await expect(maintenance!.drainDefault(2)).rejects.toThrow(/exceed the 2-row drain threshold/);
    // Nothing moved: the refusal is before any delete.
    expect(await maintenance!.countDefault()).toBe(5);
  });

  dbTest("the oldest month is drained first", async () => {
    // So a long outage recovers in order and the earliest data becomes
    // prunable soonest.
    await resetPartitions();
    await insertEvent("2033-02-01T00:00:00Z", "later");
    await insertEvent("2033-01-01T00:00:00Z", "earlier");

    await maintenance!.drainDefault(1_000);
    const names = (await maintenance!.list()).map((p) => p.name);
    expect(names).toContain("events_2033_01");
    expect(names).not.toContain("events_2033_02");
  });

  dbTest("draining an empty default is zero, not an error", async () => {
    await resetPartitions();
    expect(await maintenance!.drainDefault(100)).toBe(0);
  });

  dbTest("every column survives the round trip", async () => {
    // The move re-inserts by column name; a column dropped in the process
    // would silently lose data that is expensive to notice.
    await resetPartitions();
    await maintenance!.create(partitionFor(MARCH));
    await pool!.query(
      `INSERT INTO events (project_id, occurred_at, name, visit_id, person_id, idempotency_key, properties, os_name, os_name_raw)
       VALUES ($1, '2029-09-05T00:00:00Z', 'signup', 'v9', 'usr_9', 'rich', '{"path":"/x"}'::jsonb, 'macos', 'Mac OS X')`,
      [PRJ],
    );
    expect(await maintenance!.drainDefault(10)).toBe(1);

    const { rows } = await pool!.query<Record<string, unknown>>(
      `SELECT name, visit_id, person_id, properties, os_name, os_name_raw FROM ONLY events_2029_09`,
    );
    expect(rows[0]).toMatchObject({
      name: "signup",
      visit_id: "v9",
      person_id: "usr_9",
      properties: { path: "/x" },
      os_name: "macos",
      os_name_raw: "Mac OS X",
    });
  });
});
