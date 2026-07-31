/**
 * Live statement tests.
 *
 * These run the compiled SQL against a real PostgreSQL. String assertions
 * prove intent; only execution proves the statement is valid, that
 * `width_bucket` indexes the way the domain expects, and that the numbers
 * coming back are the numbers the domain would have computed.
 *
 * Skipped automatically when no database is reachable, so the suite stays
 * runnable on a laptop with nothing running. CI (#41) sets TEST_DATABASE_URL.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
  Analysis,
  FieldRef,
  Instant,
  Measure,
  Predicate,
  TimeAxis,
  Window,
  type Grain,
} from "@counted/domain";
import { SCHEMA_STATEMENTS } from "../sql/schema";
import { INDEX_STATEMENTS } from "../sql/indexes";
import { createPartitionSql, partitionsCovering } from "../partitions";
import { Params } from "./params";
import { breakdownDimension, compileBreakdown, compileScalar, compileSeries } from "./statements";

const ADMIN = process.env["TEST_ADMIN_URL"] ?? "postgres://counted:counted@localhost:5434/postgres";
const DB = "counted_v2_statements";
const URL = process.env["TEST_DATABASE_URL"] ?? `postgres://counted:counted@localhost:5434/${DB}`;

const PROJECT = "11111111-1111-1111-1111-111111111111";
const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));
const NOW = iso("2026-03-01T00:00:00Z");

let pool: Pool | null = null;
let reachable = false;
let reason = "";

/**
 * A test that needs a database.
 *
 * Skips when none is reachable, so the suite runs on a laptop with nothing
 * started — but **fails loudly when REQUIRE_DB=1**, which CI sets. A guard
 * that silently passes is worse than no guard: it turns "the database was
 * unreachable in CI" into a green build.
 *
 * The first version of this used `describe.if(() => reachable)`, which takes a
 * boolean rather than a thunk — so a function was always truthy and the guard
 * did nothing in either direction.
 */
const dbTest = (name: string, fn: () => Promise<void>): void =>
  test(name, async () => {
    if (!reachable) {
      if (process.env["REQUIRE_DB"] === "1") {
        throw new Error(`REQUIRE_DB=1 but no database was reachable: ${reason}`);
      }
      return;
    }
    await fn();
  });

const run = async (sql: string, values: readonly unknown[]) =>
  (await pool!.query(sql, [...values])).rows;

beforeAll(async () => {
  try {
    const admin = new Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1_500 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    await admin.end();

    pool = new Pool({ connectionString: URL });
    for (const s of SCHEMA_STATEMENTS) await pool.query(s);
    for (const s of INDEX_STATEMENTS) await pool.query(s);
    for (const s of partitionsCovering(iso("2026-01-01T00:00:00Z"), iso("2026-03-01T00:00:00Z"), 1)) {
      await pool.query(createPartitionSql(s));
    }

    // A deliberately awkward fixture: an unidentified visit, a repeated visit,
    // a numeric string, and a value that is not a number at all.
    const insert = `INSERT INTO events
      (project_id, occurred_at, name, visit_id, person_id, idempotency_key, properties, os_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
    const rows: readonly [string, string, string, string | null, string, Record<string, unknown>, string][] = [
      ["2026-02-01T10:00:00Z", "page_view", "v1", "p1", "a", { plan: "pro", amount: 100 }, "macOS"],
      ["2026-02-01T23:59:59Z", "page_view", "v1", "p1", "b", { plan: "pro", amount: "250" }, "macOS"],
      ["2026-02-02T00:00:00Z", "page_view", "v2", null, "c", { plan: "free", amount: "nope" }, "Windows"],
      ["2026-02-05T12:00:00Z", "purchase", "v3", "p2", "d", { plan: "pro", amount: 50 }, "macOS"],
      ["2026-02-20T12:00:00Z", "page_view", "v4", null, "e", { plan: "free" }, "Linux"],
    ];
    for (const [ts, name, visit, person, key, props, os] of rows) {
      await pool.query(insert, [PROJECT, ts, name, visit, person, key, JSON.stringify(props), os]);
    }
    reachable = true;
  } catch (e) {
    reachable = false;
    reason = (e as Error).message;
  }
});

afterAll(async () => {
  if (pool !== null) await pool.end();
  try {
    const admin = new Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1_500 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.end();
  } catch {
    /* nothing to clean up */
  }
});

const spec = (analysis: Analysis) => ({
  project: PROJECT,
  analysis,
  from: new Date(Date.parse("2026-02-01T00:00:00Z")),
  to: new Date(Date.parse("2026-03-01T00:00:00Z")),
});

const scalar = async (analysis: Analysis): Promise<number> => {
  const params = new Params();
  const sql = compileScalar(spec(analysis), params);
  const rows = await run(sql, params.all);
  return Number(rows[0]?.value ?? 0);
};

describe("scalar", () => {
  dbTest("counts, and honours the event filter", async () => {
    expect(await scalar(Analysis.countOverWindow(Window.lastDays(30)))).toBe(5);
    expect(
      await scalar({ measure: Measure.count(), events: ["page_view"], window: Window.lastDays(30) }),
    ).toBe(4);
  });

  dbTest("distinct visits and distinct people are different numbers", async () => {
    expect(await scalar({ measure: Measure.distinctVisits(), window: Window.lastDays(30) })).toBe(4);
    // Only p1 and p2 ever called identify().
    expect(await scalar({ measure: Measure.distinctPeople(), window: Window.lastDays(30) })).toBe(2);
  });

  dbTest("a guarded aggregate skips the unparseable row rather than failing", async () => {
    // 100 + 250 + 50. "nope" contributes nothing, and the missing key on the
    // last row contributes nothing. v1 raised 22P02 and lost the whole insight.
    expect(await scalar({ measure: Measure.aggregate("sum", "amount"), window: Window.lastDays(30) })).toBe(400);
  });

  dbTest("property equality filters via containment", async () => {
    expect(
      await scalar({
        measure: Measure.count(),
        where: Predicate.eq(FieldRef.property("plan"), "pro"),
        window: Window.lastDays(30),
      }),
    ).toBe(3);
  });

  dbTest("a numeric comparison over mixed types matches only real numbers", async () => {
    expect(
      await scalar({
        measure: Measure.count(),
        where: Predicate.gt(FieldRef.property("amount"), 75),
        window: Window.lastDays(30),
      }),
    ).toBe(2);
  });
});

describe("series — bucket assignment agrees with the domain", () => {
  const check = async (grain: Grain, window: Window) => {
    const axis = TimeAxis.build(window, grain, NOW);
    const params = new Params();
    const sql = compileSeries(
      { ...spec(Analysis.timeSeries(Measure.count(), window, grain)), from: new Date(Instant.toEpochMillis(axis.edges[0]!)), to: new Date(Instant.toEpochMillis(axis.edges[axis.edges.length - 1]!)) },
      axis,
      params,
    );
    const rows = await run(sql, params.all);
    return TimeAxis.densify(
      axis,
      rows.map((r) => ({ index: Number(r.bucket_ix), value: Number(r.value) })),
    );
  };

  dbTest("daily buckets land where TimeAxis.assign says they do", async () => {
    const window = Window.between(iso("2026-02-01T00:00:00Z"), iso("2026-02-07T00:00:00Z"));
    const axis = TimeAxis.build(window, "day", NOW);
    const dense = await check("day", window);

    // Two events on Feb 1 (one at 23:59:59, which must not spill into Feb 2),
    // one exactly at Feb 2 00:00:00, one on Feb 5.
    const expected = TimeAxis.densify(axis, [
      { index: TimeAxis.assign(axis, iso("2026-02-01T10:00:00Z"))!, value: 2 },
      { index: TimeAxis.assign(axis, iso("2026-02-02T00:00:00Z"))!, value: 1 },
      { index: TimeAxis.assign(axis, iso("2026-02-05T12:00:00Z"))!, value: 1 },
    ]);
    expect(dense).toEqual(expected);
  });

  dbTest("an event exactly on an edge belongs to the bucket that edge starts", async () => {
    const window = Window.between(iso("2026-02-01T00:00:00Z"), iso("2026-02-03T00:00:00Z"));
    const axis = TimeAxis.build(window, "day", NOW);
    const dense = await check("day", window);
    // 23:59:59 on the 1st and 00:00:00 on the 2nd are adjacent instants in
    // different buckets. Getting this wrong is how midnight traffic lands on
    // the wrong day.
    expect(dense[TimeAxis.assign(axis, iso("2026-02-01T23:59:59Z"))!]).toBe(2);
    expect(dense[TimeAxis.assign(axis, iso("2026-02-02T00:00:00Z"))!]).toBe(1);
  });

  dbTest("empty buckets come back as zeros, not as missing rows", async () => {
    const window = Window.between(iso("2026-02-01T00:00:00Z"), iso("2026-02-07T00:00:00Z"));
    const dense = await check("day", window);
    expect(dense.length).toBeGreaterThan(3);
    expect(dense.filter((v) => v === 0).length).toBeGreaterThan(0);
    expect(dense.reduce((a, b) => a + b, 0)).toBe(4);
  });

  dbTest("weekly and monthly grains agree too", async () => {
    for (const [grain, window] of [
      ["week", Window.between(iso("2026-02-01T00:00:00Z"), iso("2026-03-01T00:00:00Z"))],
      ["month", Window.between(iso("2026-01-01T00:00:00Z"), iso("2026-03-01T00:00:00Z"))],
    ] as const) {
      const dense = await check(grain, window);
      expect(dense.reduce((a, b) => a + b, 0)).toBe(5);
    }
  });
});

describe("breakdown", () => {
  dbTest("groups, orders by value and always applies a limit", async () => {
    const analysis = Analysis.breakdown(Measure.count(), FieldRef.system("os_name"), Window.lastDays(30), 10);
    const params = new Params();
    const sql = compileBreakdown(spec(analysis), breakdownDimension(analysis)!, 10, params);
    const rows = await run(sql, params.all);

    expect(rows.map((r) => r.label)).toEqual(["macOS", "Linux", "Windows"]);
    expect(Number(rows[0]!.value)).toBe(3);
    expect(sql).toContain("LIMIT");
  });

  dbTest("a missing property groups as unknown rather than vanishing", async () => {
    const analysis = Analysis.breakdown(Measure.count(), FieldRef.property("amount"), Window.lastDays(30), 10);
    const params = new Params();
    const rows = await run(compileBreakdown(spec(analysis), breakdownDimension(analysis)!, 10, params), params.all);
    expect(rows.some((r) => r.label === "unknown")).toBe(true);
  });

  dbTest("the limit is real — it caps rows even when more groups exist", async () => {
    const analysis = Analysis.breakdown(Measure.count(), FieldRef.system("os_name"), Window.lastDays(30), 1);
    const params = new Params();
    const rows = await run(compileBreakdown(spec(analysis), breakdownDimension(analysis)!, 1, params), params.all);
    expect(rows).toHaveLength(1);
  });
});
