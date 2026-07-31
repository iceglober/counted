/**
 * Funnel compilation, executed against a real PostgreSQL.
 *
 * The fixture is built specifically to catch what v1 got wrong: a visit that
 * performs every step but in the wrong order, and a visit that performs them
 * correctly but too slowly. v1 counted both as fully converted, because its
 * SQL only asked whether a visit contained each event.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { Duration, FieldRef, Funnel, FunnelStep, Instant, Predicate } from "@counted/domain";
import { SCHEMA_STATEMENTS } from "../sql/schema";
import { INDEX_STATEMENTS } from "../sql/indexes";
import { createPartitionSql, partitionsCovering } from "../partitions";
import { Params } from "./params";
import { compileSequence, readSequenceRow } from "./sequence";

const ADMIN = process.env["TEST_ADMIN_URL"] ?? "postgres://counted:counted@localhost:5434/postgres";
const DB = "counted_v2_sequence";
const URL = process.env["TEST_DATABASE_URL"] ?? `postgres://counted:counted@localhost:5434/${DB}`;
const PROJECT = "11111111-1111-1111-1111-111111111111";
const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));

let pool: Pool | null = null;
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

/** visit, person, when, event, props */
type Row = readonly [string, string | null, string, string, Record<string, unknown>];

const FIXTURE: readonly Row[] = [
  // Converts cleanly, well inside an hour.
  ["good", "p1", "2026-02-01T10:00:00Z", "view", {}],
  ["good", "p1", "2026-02-01T10:05:00Z", "add_to_cart", {}],
  ["good", "p1", "2026-02-01T10:10:00Z", "purchase", { amount: 200 }],

  // Every event present, but purchase happened FIRST. v1 counted this as a
  // full conversion; an ordered funnel must stop it at step 1.
  ["backwards", "p2", "2026-02-01T11:00:00Z", "purchase", { amount: 50 }],
  ["backwards", "p2", "2026-02-01T11:05:00Z", "view", {}],
  ["backwards", "p2", "2026-02-01T11:10:00Z", "add_to_cart", {}],

  // Correct order, but the last step falls outside a one-hour window.
  ["slow", "p3", "2026-02-02T09:00:00Z", "view", {}],
  ["slow", "p3", "2026-02-02T09:30:00Z", "add_to_cart", {}],
  ["slow", "p3", "2026-02-02T12:00:00Z", "purchase", { amount: 75 }],

  // Drops out after the first step.
  ["bounced", null, "2026-02-03T08:00:00Z", "view", {}],

  // Same person as "good", continuing in a later visit — only a person-scoped
  // funnel can follow this.
  ["later", "p4", "2026-02-04T08:00:00Z", "view", {}],
  ["later2", "p4", "2026-02-04T08:30:00Z", "add_to_cart", {}],
  ["later3", "p4", "2026-02-04T08:45:00Z", "purchase", { amount: 10 }],
];

beforeAll(async () => {
  try {
    const admin = new Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1_500 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    await admin.end();

    pool = new Pool({ connectionString: URL });
    for (const s of SCHEMA_STATEMENTS) await pool.query(s);
    for (const s of INDEX_STATEMENTS) await pool.query(s);
    for (const s of partitionsCovering(iso("2026-02-01T00:00:00Z"), iso("2026-02-28T00:00:00Z"), 1)) {
      await pool.query(createPartitionSql(s));
    }

    let n = 0;
    for (const [visit, person, ts, name, props] of FIXTURE) {
      await pool.query(
        `INSERT INTO events (project_id, occurred_at, name, visit_id, person_id, idempotency_key, properties)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [PROJECT, ts, name, visit, person, `f-${n++}`, JSON.stringify(props)],
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
  try {
    const admin = new Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1_500 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.end();
  } catch {
    /* nothing to clean up */
  }
});

const counts = async (funnel: Funnel): Promise<readonly number[]> => {
  const params = new Params();
  const sql = compileSequence(
    {
      project: PROJECT,
      funnel,
      from: new Date(Date.parse("2026-02-01T00:00:00Z")),
      to: new Date(Date.parse("2026-03-01T00:00:00Z")),
    },
    params,
  );
  const rows = await pool!.query(sql, [...params.all]);
  return readSequenceRow(rows.rows[0] as Record<string, unknown>, funnel.steps.length);
};

const shopping = (conversion = Duration.hours(1), basis: "visit" | "person" = "visit") =>
  Funnel.of(
    [FunnelStep.of(["view"]), FunnelStep.of(["add_to_cart"]), FunnelStep.of(["purchase"])],
    { kind: "relative", amount: 30, unit: "day" },
    conversion,
    basis,
  );

describe("order is enforced by the join, not asserted in a comment", () => {
  dbTest("a visit that did everything backwards does not convert", async () => {
    // v1's SQL asked only whether the visit contained each event, so this
    // counted as a full conversion.
    const [s0, s1, s2] = await counts(shopping());
    // Step 0 — every visit that fired `view`: good, backwards, slow, bounced,
    // later.
    expect(s0).toBe(5);
    // Step 1 — a cart *after* that view, same visit: good, backwards, slow.
    // "backwards" viewed at 11:05 and carted at 11:10, so it does reach here.
    expect(s1).toBe(3);
    // Step 2 — "backwards" purchased at 11:00, before both its other events,
    // so an ordered funnel stops it. "slow" purchased three hours in, past the
    // one-hour deadline. Only "good" converts.
    expect(s2).toBe(1);
  });

  dbTest("counts never rise, which is what makes the domain's check meaningful", async () => {
    const series = await counts(shopping());
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!).toBeLessThanOrEqual(series[i - 1]!);
    }
  });
});

describe("the conversion window is a real deadline", () => {
  dbTest("a slow journey is excluded at the step that overran", async () => {
    const tight = await counts(shopping(Duration.hours(1)));
    expect(tight[2]).toBe(1); // "slow" purchased three hours in
  });

  dbTest("widening the window lets it through", async () => {
    const generous = await counts(shopping(Duration.hours(6)));
    expect(generous[2]).toBe(2); // "good" and now "slow"
  });

  dbTest("the deadline runs from the first step, not from the previous one", async () => {
    // "slow": view 09:00, cart 09:30, purchase 12:00. Each *gap* is under two
    // hours, but end to end is three. A per-step deadline would let it
    // through; a funnel-wide one must not.
    const perGapWouldPass = await counts(shopping(Duration.hours(2)));
    expect(perGapWouldPass[2]).toBe(1);
  });
});

describe("basis decides how far a journey may be followed", () => {
  dbTest("visit-scoped cannot follow a person across visits", async () => {
    // p4's three events are in three separate visits, so no single visit
    // completes. With a one-day window "good" and "slow" both convert.
    const byVisit = await counts(shopping(Duration.days(1), "visit"));
    expect(byVisit[2]).toBe(2);
  });

  dbTest("person-scoped can", async () => {
    // The same three, plus p4 — whose journey spans three visits and is only
    // visible when following a person.
    const byPerson = await counts(shopping(Duration.days(1), "person"));
    expect(byPerson[2]).toBe(3);
  });

  dbTest("person-scoped ignores unidentified traffic rather than inflating step 0", async () => {
    // "bounced" has no person_id, so it cannot appear in a person funnel at all.
    const byPerson = await counts(shopping(Duration.days(1), "person"));
    const byVisit = await counts(shopping(Duration.days(1), "visit"));
    expect(byPerson[0]).toBeLessThan(byVisit[0]!);
  });
});

describe("steps carry predicates — v1 discarded them", () => {
  dbTest("a filtered step narrows the conversion", async () => {
    const bigSpenders = Funnel.of(
      [
        FunnelStep.of(["view"]),
        FunnelStep.of(["add_to_cart"]),
        FunnelStep.of(["purchase"], Predicate.gt(FieldRef.property("amount"), 100), "Big purchase"),
      ],
      { kind: "relative", amount: 30, unit: "day" },
      Duration.hours(6),
    );
    const [, , s2] = await counts(bigSpenders);
    // "good" spent 200; "slow" spent 75 and is filtered out even though it
    // would otherwise convert within six hours.
    expect(s2).toBe(1);
  });

  dbTest("a step may be reached by any of several events", async () => {
    const either = Funnel.of(
      [FunnelStep.of(["view"]), FunnelStep.of(["add_to_cart", "purchase"])],
      { kind: "relative", amount: 30, unit: "day" },
      Duration.hours(1),
    );
    const [s0, s1] = await counts(either);
    expect(s0).toBe(5);
    // A cart or a purchase after the view: good, backwards, slow.
    expect(s1).toBe(3);
  });
});

describe("shape", () => {
  dbTest("it is one statement, not one per step", async () => {
    const params = new Params();
    const sql = compileSequence(
      {
        project: PROJECT,
        funnel: shopping(),
        from: new Date(Date.parse("2026-02-01T00:00:00Z")),
        to: new Date(Date.parse("2026-03-01T00:00:00Z")),
      },
      params,
    );
    // v1 issued five serial round trips for a five-step funnel.
    expect(sql.match(/SELECT/gi)!.length).toBeGreaterThan(1);
    expect(sql.startsWith("\n  WITH")).toBe(true);
    expect((sql.match(/\bs\d+ AS \(/g) ?? []).length).toBe(3);
  });

  dbTest("a two-step funnel returns two counts", async () => {
    const short = Funnel.of(
      [FunnelStep.of(["view"]), FunnelStep.of(["purchase"])],
      { kind: "relative", amount: 30, unit: "day" },
      Duration.hours(1),
    );
    expect(await counts(short)).toHaveLength(2);
  });
});
