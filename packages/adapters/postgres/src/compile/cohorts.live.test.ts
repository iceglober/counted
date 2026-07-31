/**
 * Retention compilation, executed against a real PostgreSQL, then fed through
 * the domain's `buildGrid` — because the store's job is only to return counts,
 * and the grid arithmetic that turns them into a chart lives in the domain.
 *
 * The fixture includes a person who skips a period entirely, which is the
 * shape v1 got wrong: it collected only the periods that had activity, sorted
 * them, and read offset k positionally, so an empty period shifted every later
 * column left.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { createDatabase, type LiveDatabase } from "../testing/database";
import { Instant, Retention, TimeAxis, Window } from "@counted/domain";
import { SCHEMA_STATEMENTS } from "../sql/schema";
import { INDEX_STATEMENTS } from "../sql/indexes";
import { createPartitionSql, partitionsCovering } from "../partitions";
import { Params } from "./params";
import { compileCohorts, readCohortRows, type CohortRow } from "./cohorts";

const DB = "counted_v2_cohorts";
const PROJECT = "11111111-1111-1111-1111-111111111111";
const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));
const NOW = iso("2026-02-15T00:00:00Z");

let pool: Pool | null = null;
let live: LiveDatabase | null = null;
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

/** person, when, event */
const FIXTURE: readonly (readonly [string | null, string, string])[] = [
  // Day 0 cohort (Feb 1). Three people join.
  ["alice", "2026-02-01T10:00:00Z", "open"],
  ["bob", "2026-02-01T11:00:00Z", "open"],
  ["carol", "2026-02-01T12:00:00Z", "open"],

  // alice returns on +1 and +3, skipping +2 entirely.
  ["alice", "2026-02-02T10:00:00Z", "open"],
  ["alice", "2026-02-04T10:00:00Z", "open"],

  // bob returns only on +1.
  ["bob", "2026-02-02T11:00:00Z", "open"],

  // carol never returns.

  // A second cohort on Feb 3.
  ["dave", "2026-02-03T10:00:00Z", "open"],
  ["dave", "2026-02-04T10:00:00Z", "open"],

  // Unidentified traffic — must not appear in any cohort.
  [null, "2026-02-01T09:00:00Z", "open"],
  [null, "2026-02-02T09:00:00Z", "open"],
];

beforeAll(async () => {
  try {
    live = await createDatabase(DB);
    pool = live.pool;
    for (const s of SCHEMA_STATEMENTS) await pool.query(s);
    for (const s of INDEX_STATEMENTS) await pool.query(s);
    for (const s of partitionsCovering(iso("2026-02-01T00:00:00Z"), iso("2026-02-28T00:00:00Z"), 1)) {
      await pool.query(createPartitionSql(s));
    }

    let n = 0;
    for (const [person, ts, name] of FIXTURE) {
      await pool.query(
        `INSERT INTO events (project_id, occurred_at, name, visit_id, person_id, idempotency_key, properties)
         VALUES ($1,$2,$3,$4,$5,$6,'{}'::jsonb)`,
        [PROJECT, ts, name, `v${n}`, person, `r-${n++}`],
      );
    }
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

const WINDOW = Window.between(iso("2026-02-01T00:00:00Z"), iso("2026-02-08T00:00:00Z"));

const gridFor = async (periods = 4) => {
  const retention = Retention.of(WINDOW, "day", periods);
  const axis = TimeAxis.build(WINDOW, "day", NOW);
  const params = new Params();
  const sql = compileCohorts(
    {
      project: PROJECT,
      retention,
      from: new Date(Instant.toEpochMillis(axis.edges[0]!)),
      to: new Date(Instant.toEpochMillis(axis.edges[axis.edges.length - 1]!)),
    },
    axis,
    params,
  );
  const rows = (await pool!.query(sql, [...params.all])).rows as CohortRow[];
  const { sizes, observations } = readCohortRows(rows, axis);
  return Retention.buildGrid(retention, sizes, observations, NOW);
};

describe("cohorts are keyed on people", () => {
  dbTest("unidentified traffic never forms a cohort", async () => {
    // v1 cohorted on session_id, which expires after 30 minutes idle, so every
    // cohort past period 0 was ~0 by construction under a header reading "Users".
    const grid = await gridFor();
    const total = grid.cohorts.reduce((n, c) => n + c.size, 0);
    expect(total).toBe(4); // alice, bob, carol, dave — the two NULL rows excluded
  });

  dbTest("a person is placed in the period they were first seen", async () => {
    const grid = await gridFor();
    const starts = grid.cohorts.map((c) => Instant.toISO(c.start));
    expect(starts).toEqual(["2026-02-01T00:00:00.000Z", "2026-02-03T00:00:00.000Z"]);
    expect(grid.cohorts[0]!.size).toBe(3); // alice, bob, carol
    expect(grid.cohorts[1]!.size).toBe(1); // dave
  });
});

describe("offsets are calendar positions, not array indices", () => {
  dbTest("a skipped period stays a zero and does not shift later columns", async () => {
    // This is the v1 bug reproduced. alice returned on +1 and +3 but not +2.
    // v1 collected only the periods with activity, so +3's number was read
    // into the +2 column and everything after slid left.
    const grid = await gridFor();
    const first = grid.cohorts[0]!;

    expect(first.cells[0]).toMatchObject({ returned: 3 }); // everyone, by definition
    expect(first.cells[1]).toMatchObject({ returned: 2 }); // alice + bob
    expect(first.cells[2]).toMatchObject({ returned: 0 }); // nobody — a real zero
    expect(first.cells[3]).toMatchObject({ returned: 1 }); // alice, in the right column
  });

  dbTest("rates are percentages of the cohort", async () => {
    const grid = await gridFor();
    const first = grid.cohorts[0]!;
    expect(first.cells[0]!.rate).toBe(100);
    expect(first.cells[1]!.rate).toBeCloseTo(66.667, 2);
    expect(first.cells[3]!.rate).toBeCloseTo(33.333, 2);
  });
});

describe("unknowable is not zero", () => {
  dbTest("a period that has not happened yet is null", async () => {
    // The Feb 3 cohort's +4 lands on Feb 7. With `now` at Feb 15 that has
    // happened, so widen the ask until it has not.
    const retention = Retention.of(WINDOW, "day", 4);
    const axis = TimeAxis.build(WINDOW, "day", NOW);
    const params = new Params();
    const sql = compileCohorts(
      {
        project: PROJECT,
        retention,
        from: new Date(Instant.toEpochMillis(axis.edges[0]!)),
        to: new Date(Instant.toEpochMillis(axis.edges[axis.edges.length - 1]!)),
      },
      axis,
      params,
    );
    const rows = (await pool!.query(sql, [...params.all])).rows as CohortRow[];
    const { sizes, observations } = readCohortRows(rows, axis);

    // Pretend it is only Feb 4: the Feb 3 cohort cannot yet have a +2.
    const early = Retention.buildGrid(retention, sizes, observations, iso("2026-02-04T12:00:00Z"));
    const second = early.cohorts.find((c) => Instant.toISO(c.start).startsWith("2026-02-03"))!;
    expect(second.cells[0]).not.toBeNull();
    expect(second.cells[1]).not.toBeNull(); // Feb 4 has begun
    expect(second.cells[2]).toBeNull(); // Feb 5 has not
  });
});

describe("shape", () => {
  dbTest("every cohort gets the full width", async () => {
    const grid = await gridFor(4);
    expect(grid.offsets).toEqual([0, 1, 2, 3, 4]);
    for (const cohort of grid.cohorts) expect(cohort.cells).toHaveLength(5);
  });

  dbTest("no date_trunc anywhere — the unvalidated unit parameter is gone", async () => {
    const params = new Params();
    const axis = TimeAxis.build(WINDOW, "day", NOW);
    const sql = compileCohorts(
      {
        project: PROJECT,
        retention: Retention.of(WINDOW, "day", 3),
        from: new Date(Instant.toEpochMillis(axis.edges[0]!)),
        to: new Date(Instant.toEpochMillis(axis.edges[axis.edges.length - 1]!)),
      },
      axis,
      params,
    );
    expect(sql).not.toContain("date_trunc");
    expect(sql).toContain("width_bucket");
  });

  dbTest("it is one statement, and sizes come back with the counts", async () => {
    const grid = await gridFor();
    // A separate size query would be a second round trip against a possibly
    // different snapshot.
    expect(grid.cohorts.every((c) => c.size > 0)).toBe(true);
  });
});
