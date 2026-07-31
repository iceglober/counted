/**
 * Rollups, against a real PostgreSQL.
 *
 * A rollup is a second representation of data that already exists, so the only
 * test that really counts is a differential: recompute the same numbers
 * straight from `events` and assert they match, including after backdated
 * arrivals and after a retention purge has taken rows away.
 *
 * This is the same guard the bucket contract applies to the time axis. Where
 * there are two implementations of one number, something has to compare them.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { Instant, ProjectId } from "@counted/domain";
import { createDatabase, type LiveDatabase } from "./testing/database";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import { CONTROL_PLANE_STATEMENTS } from "./sql/control-plane";
import { createPartitionMaintenance } from "./partition-maintenance";
import { createRollupMaintenance } from "./rollups";
import { partitionFor } from "./partitions";

const DB = "counted_v2_rollups";
const PRJ = ProjectId("33333333-3333-3333-3333-333333333333");
const OTHER = ProjectId("33333333-3333-3333-3333-333333333344");

let pool: Pool | null = null;
let live: LiveDatabase | null = null;
let rollups: ReturnType<typeof createRollupMaintenance> | null = null;
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
    rollups = createRollupMaintenance(pool);
    partitions = createPartitionMaintenance(pool);
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

const reset = async () => {
  await pool!.query("TRUNCATE rollup_daily, rollup_state");
  for (const spec of await partitions!.list()) await pool!.query(`DROP TABLE IF EXISTS ${spec.name}`);
  await pool!.query("TRUNCATE ONLY events_default");
};

type Seed = {
  project?: ProjectId;
  occurredAt: string;
  ingestedAt?: string;
  name?: string;
  visit?: string;
  person?: string | null;
  key: string;
};

const seed = async (event: Seed) => {
  await partitions!.create(partitionFor(at(event.occurredAt)));
  await pool!.query(
    `INSERT INTO events (project_id, occurred_at, ingested_at, name, visit_id, person_id, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      event.project ?? PRJ,
      event.occurredAt,
      event.ingestedAt ?? event.occurredAt,
      event.name ?? "page_view",
      event.visit ?? "v1",
      event.person ?? null,
      event.key,
    ],
  );
};

/** The same numbers, straight from `events`. The thing the rollup must equal. */
const fromRaw = async (project: ProjectId) => {
  const { rows } = await pool!.query<{ day: Date; name: string; events: string; visits: string; people: string }>(
    `SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day,
            name,
            count(*)::text AS events,
            count(DISTINCT visit_id)::text AS visits,
            count(DISTINCT person_id)::text AS people
       FROM events WHERE project_id = $1
      GROUP BY 1,2 ORDER BY 1,2`,
    [project],
  );
  return rows.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    name: r.name,
    events: Number(r.events),
    visits: Number(r.visits),
    people: Number(r.people),
  }));
};

const refreshAll = async (to: Instant) => {
  const watermark = await rollups!.watermark();
  await rollups!.refresh(watermark, to);
  await rollups!.commitWatermark(to);
};

const stored = (from = "2020-01-01T00:00:00Z", to = "2030-01-01T00:00:00Z", project = PRJ) =>
  rollups!.dailyCounts(project, at(from), at(to));

describe("the rollup equals a fresh computation from the source", () => {
  dbTest("a simple day matches", async () => {
    await reset();
    await seed({ occurredAt: "2026-03-17T09:00:00Z", key: "a" });
    await seed({ occurredAt: "2026-03-17T10:00:00Z", key: "b" });
    await seed({ occurredAt: "2026-03-17T11:00:00Z", name: "signup", key: "c" });

    await refreshAll(at("2026-03-18T00:00:00Z"));
    expect(await stored()).toEqual(await fromRaw(PRJ));
  });

  dbTest("distinct visits and people are counted, not summed", async () => {
    // Three events, two visits, one person. A rollup that summed would report
    // three of each and nobody would notice until a chart looked wrong.
    await reset();
    await seed({ occurredAt: "2026-03-17T09:00:00Z", visit: "v1", person: "u1", key: "a" });
    await seed({ occurredAt: "2026-03-17T10:00:00Z", visit: "v1", person: "u1", key: "b" });
    await seed({ occurredAt: "2026-03-17T11:00:00Z", visit: "v2", person: "u1", key: "c" });

    await refreshAll(at("2026-03-18T00:00:00Z"));
    const [row] = await stored();
    expect(row).toMatchObject({ events: 3, visits: 2, people: 1 });
    expect(await stored()).toEqual(await fromRaw(PRJ));
  });

  dbTest("anonymous events count no people", async () => {
    // `person_id` is null unless the customer called identify(). Counting
    // nulls as people is how v1's "unique users" came to mean visits.
    await reset();
    await seed({ occurredAt: "2026-03-17T09:00:00Z", person: null, key: "a" });
    await refreshAll(at("2026-03-18T00:00:00Z"));
    expect((await stored())[0]).toMatchObject({ events: 1, people: 0 });
  });

  dbTest("projects do not bleed into each other", async () => {
    await reset();
    await seed({ occurredAt: "2026-03-17T09:00:00Z", key: "mine" });
    await seed({ project: OTHER, occurredAt: "2026-03-17T09:00:00Z", key: "theirs" });

    await refreshAll(at("2026-03-18T00:00:00Z"));
    expect(await stored()).toEqual(await fromRaw(PRJ));
    expect(await stored("2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z", OTHER)).toEqual(await fromRaw(OTHER));
  });

  dbTest("days are UTC, so an event at 23:30 does not land on the next day", async () => {
    await reset();
    await seed({ occurredAt: "2026-03-17T23:30:00Z", key: "late" });
    await seed({ occurredAt: "2026-03-18T00:30:00Z", key: "early" });

    await refreshAll(at("2026-03-19T00:00:00Z"));
    expect((await stored()).map((r) => r.day)).toEqual(["2026-03-17", "2026-03-18"]);
  });
});

describe("a backdated event dirties the bucket it belongs to", () => {
  dbTest("an event arriving months late is rolled into its own day", async () => {
    // The ingest contract accepts events backdated up to ninety days. A
    // trailing-window refresh would miss this silently, which is the failure
    // that makes people stop trusting a rollup.
    await reset();
    await seed({ occurredAt: "2026-03-01T09:00:00Z", ingestedAt: "2026-03-01T09:00:00Z", key: "ontime" });
    await refreshAll(at("2026-03-02T00:00:00Z"));

    await seed({
      occurredAt: "2026-03-01T10:00:00Z",
      // Arrived in June, belongs to March.
      ingestedAt: "2026-06-01T00:00:00Z",
      visit: "v2",
      key: "late",
    });
    await refreshAll(at("2026-06-02T00:00:00Z"));

    expect(await stored()).toEqual(await fromRaw(PRJ));
    expect((await stored())[0]).toMatchObject({ events: 2, visits: 2 });
  });

  dbTest("an untouched bucket is not rewritten", async () => {
    // The dirty set is exactly what was ingested in the window; recomputing
    // everything every run would make the job's cost grow with history.
    await reset();
    await seed({ occurredAt: "2026-01-05T09:00:00Z", ingestedAt: "2026-01-05T09:00:00Z", key: "old" });
    await refreshAll(at("2026-01-06T00:00:00Z"));

    const before = (
      await pool!.query<{ refreshed_at: Date }>(`SELECT refreshed_at FROM rollup_daily WHERE day = '2026-01-05'`)
    ).rows[0]!.refreshed_at;

    await seed({ occurredAt: "2026-02-05T09:00:00Z", ingestedAt: "2026-02-05T09:00:00Z", key: "new" });
    await refreshAll(at("2026-02-06T00:00:00Z"));

    const after = (
      await pool!.query<{ refreshed_at: Date }>(`SELECT refreshed_at FROM rollup_daily WHERE day = '2026-01-05'`)
    ).rows[0]!.refreshed_at;
    expect(after.getTime()).toBe(before.getTime());
  });
});

describe("running twice changes nothing", () => {
  dbTest("recomputing the same window is a no-op", async () => {
    // The lease guarantees this. An incremental counter would double here and
    // nothing would ever notice.
    await reset();
    await seed({ occurredAt: "2026-03-17T09:00:00Z", key: "a" });
    await seed({ occurredAt: "2026-03-17T10:00:00Z", key: "b" });

    await rollups!.refresh(null, at("2026-03-18T00:00:00Z"));
    const once = await stored();
    await rollups!.refresh(null, at("2026-03-18T00:00:00Z"));
    const twice = await stored();

    expect(twice).toEqual(once);
    expect(twice).toEqual(await fromRaw(PRJ));
  });

  dbTest("a full rebuild from scratch matches an incremental history", async () => {
    // The strongest form of the differential: build the rollup a window at a
    // time, then rebuild it in one pass, and require the same answer.
    await reset();
    await seed({ occurredAt: "2026-03-15T09:00:00Z", ingestedAt: "2026-03-15T09:00:00Z", key: "a" });
    await refreshAll(at("2026-03-16T00:00:00Z"));
    await seed({ occurredAt: "2026-03-16T09:00:00Z", ingestedAt: "2026-03-16T09:00:00Z", visit: "v2", key: "b" });
    await refreshAll(at("2026-03-17T00:00:00Z"));
    await seed({ occurredAt: "2026-03-15T11:00:00Z", ingestedAt: "2026-03-17T09:00:00Z", visit: "v3", key: "c" });
    await refreshAll(at("2026-03-18T00:00:00Z"));

    const incremental = await stored();

    await pool!.query("TRUNCATE rollup_daily");
    await rollups!.refresh(null, at("2026-03-18T00:00:00Z"));

    expect(await stored()).toEqual(incremental);
    expect(incremental).toEqual(await fromRaw(PRJ));
  });
});

describe("a bucket whose rows are gone does not linger", () => {
  dbTest("purged data disappears from the rollup too", async () => {
    // Otherwise retention deletes the events and the dashboard keeps reporting
    // them — a number for data the customer was told no longer exists.
    await reset();
    await seed({ occurredAt: "2026-03-17T09:00:00Z", key: "doomed" });
    await refreshAll(at("2026-03-18T00:00:00Z"));
    expect(await stored()).toHaveLength(1);

    await pool!.query(`DELETE FROM events WHERE idempotency_key = 'doomed'`);
    // A later window: the bucket is not dirty by ingestion, so this is the
    // sweep rather than the recompute doing the work.
    await refreshAll(at("2026-04-01T00:00:00Z"));

    expect(await stored()).toEqual([]);
    expect(await stored()).toEqual(await fromRaw(PRJ));
  });

  dbTest("a partially purged bucket is corrected, not emptied", async () => {
    await reset();
    await seed({ occurredAt: "2026-03-17T09:00:00Z", visit: "v1", key: "gone" });
    await seed({ occurredAt: "2026-03-17T10:00:00Z", visit: "v2", key: "kept" });
    await refreshAll(at("2026-03-18T00:00:00Z"));

    await pool!.query(`DELETE FROM events WHERE idempotency_key = 'gone'`);
    // Dirty it by re-ingesting nothing but moving the window; the recompute
    // covers it because another event in the bucket is still there.
    await pool!.query(`UPDATE events SET ingested_at = '2026-03-20T00:00:00Z' WHERE idempotency_key = 'kept'`);
    await refreshAll(at("2026-03-21T00:00:00Z"));

    expect(await stored()).toEqual(await fromRaw(PRJ));
    expect((await stored())[0]).toMatchObject({ events: 1, visits: 1 });
  });
});

describe("the watermark", () => {
  dbTest("starts absent and advances only when committed", async () => {
    await reset();
    expect(await rollups!.watermark()).toBeNull();

    await rollups!.refresh(null, at("2026-03-18T00:00:00Z"));
    // Still absent: the refresh does not move it, so a failure between the two
    // retries the window rather than skipping it.
    expect(await rollups!.watermark()).toBeNull();

    await rollups!.commitWatermark(at("2026-03-18T00:00:00Z"));
    expect(await rollups!.watermark()).toBe(at("2026-03-18T00:00:00Z"));
  });

  dbTest("committing twice leaves one row", async () => {
    await rollups!.commitWatermark(at("2026-03-19T00:00:00Z"));
    const { rows } = await pool!.query<{ n: string }>(`SELECT count(*)::text AS n FROM rollup_state`);
    expect(rows[0]!.n).toBe("1");
    expect(await rollups!.watermark()).toBe(at("2026-03-19T00:00:00Z"));
  });
});

describe("reading back", () => {
  dbTest("the range is inclusive on both ends", async () => {
    await reset();
    await seed({ occurredAt: "2026-03-15T09:00:00Z", key: "a" });
    await seed({ occurredAt: "2026-03-17T09:00:00Z", key: "b" });
    await refreshAll(at("2026-03-18T00:00:00Z"));

    expect(await stored("2026-03-15T00:00:00Z", "2026-03-17T00:00:00Z")).toHaveLength(2);
    expect(await stored("2026-03-16T00:00:00Z", "2026-03-17T00:00:00Z")).toHaveLength(1);
  });

  dbTest("an empty range is empty, not an error", async () => {
    expect(await stored("2020-01-01T00:00:00Z", "2020-02-01T00:00:00Z")).toEqual([]);
  });
});
