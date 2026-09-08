import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
  createEngine,
  flush,
  generateMigrations,
  resolveConfig,
  trackBatch,
  type TrackEvent,
} from "@litics/core";
import { Duration, Instant, ProjectId } from "@counted/kernel";
import { fixedClock } from "@counted/kernel/ports";
import { config, STREAM } from "./config";
import { RawPropertyReader } from "./raw";
import { LiticsAnalyticsEngine } from "./engine";

// Opt in explicitly; this fixture owns and removes only its random schema.
const connectionString = process.env["COUNTED_TEST_DATABASE_URL"];
const describeLive = connectionString ? describe : describe.skip;
const name = `insights_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const cfg = resolveConfig({
  ...config,
  schema: name,
  tenancy: { type: "text" },
  streams: { events: { ...config.streams.events, segmentRows: 1000 } },
});
const start = Date.UTC(2026, 8, 1);
const instant = (hours: number) =>
  Instant.fromEpochMillis(start + hours * 3_600_000);
let pool: Pool;
let engine: LiticsAnalyticsEngine;
const options = { deadline: Duration.seconds(10), traceId: "insight-live" };
const base = {
  scope: { level: "project" as const, project: ProjectId("insight_fixture") },
  bounds: { from: instant(0), to: instant(72) },
  step: "day" as const,
  event: ["page_view", "signup"],
};

async function ingest(offset: number, count: number) {
  const events: TrackEvent[] = Array.from({ length: count }, (_, n) => {
    const i = offset + n;
    return {
      tenant: "insight_fixture",
      actor: `visit_${i % 29}`,
      type: ["page_view", "signup", "noise"][i % 3]!,
      ts: new Date(start + (i % 72) * 3_600_000 + (i % 59) * 60_000),
      props: { url: ["/", "/pricing", "/docs"][Math.floor(i / 3) % 3], country: "custom-country", cost: i % 9 },
      dims: {
        country: ["US", "FR", null][i % 3]!,
        os_name: ["ios", "android", null][Math.floor(i / 3) % 3]!,
        locale: ["en", "fr", null][Math.floor(i / 9) % 3]!,
      },
    };
  });
  const statement = trackBatch(cfg, STREAM, events);
  await pool.query(statement.sql, statement.parameters);
  await pool.query(
    `INSERT INTO ${name}.oracle SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(tenant text, actor text, event_type text, ts timestamptz, country text, os_name text, locale text, props jsonb)`,
    [
      JSON.stringify(
        events.map((event) => ({
          tenant: event.tenant,
          actor: event.actor,
          event_type: event.type,
          ts: event.ts,
          ...event.dims,
          props: event.props,
        })),
      ),
    ],
  );
}

// Compare results after every storage phase; the oracle never reads summaries.
describeLive("Insight reads agree with raw SQL", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    for (const step of generateMigrations(cfg))
      for (const statement of step.statements) await pool.query(statement);
    await pool.query(
      `CREATE TABLE ${name}.oracle (tenant text, actor text, event_type text, ts timestamptz, country text, os_name text, locale text, props jsonb)`,
    );
    engine = new LiticsAnalyticsEngine({
      pool,
      clock: fixedClock(instant(96)),
      reader: createEngine(cfg, { pool }),
      rawReader: new RawPropertyReader(pool, cfg),
    });
    await ingest(0, 1200);
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
      await pool.end();
    }
  });
  for (const phase of ["staging", "packed", "packed plus tail"] as const) {
    test(`${phase}: distinct totals, split trends, and one/two/three property breakdowns`, async () => {
      if (phase === "packed") await flush(pool, cfg, STREAM);
      if (phase === "packed plus tail") await ingest(1200, 300);
      const where = `tenant = $1 AND ts >= $2::timestamptz AND ts < $3::timestamptz AND event_type = ANY($4::text[])`;
      const parameters = [
        "insight_fixture",
        Instant.toISO(base.bounds.from),
        Instant.toISO(base.bounds.to),
        base.event,
      ];
      for (const steps of [["page_view","signup","noise"],["page_view","signup","never_seen"],["page_view","never_seen","noise"],["page_view","page_view","page_view"]] as const) {
        const actual = await engine.funnel({...base,steps,within:Duration.hours(48)},options);
        if (!actual.ok) throw new Error(JSON.stringify(actual.error));
        const oracle = await pool.query(`WITH first_step AS (
          SELECT actor,min(ts) AS ts FROM ${name}.oracle WHERE tenant=$1 AND ts >= $2::timestamptz AND ts < $3::timestamptz AND event_type=$4 GROUP BY actor
        ), second_step AS (
          SELECT f.actor,min(e.ts) AS ts FROM first_step f JOIN ${name}.oracle e ON e.actor=f.actor AND e.tenant=$1 AND e.event_type=$5 AND e.ts>f.ts AND e.ts<least($3::timestamptz,f.ts+interval '48 hours') GROUP BY f.actor
        ), third_step AS (
          SELECT s.actor,min(e.ts) AS ts FROM second_step s JOIN first_step f USING(actor) JOIN ${name}.oracle e ON e.actor=s.actor AND e.tenant=$1 AND e.event_type=$6 AND e.ts>s.ts AND e.ts<least($3::timestamptz,f.ts+interval '48 hours') GROUP BY s.actor
        ) SELECT (SELECT count(*)::int FROM first_step) AS one, (SELECT count(*)::int FROM second_step) AS two, (SELECT count(*)::int FROM third_step) AS three`,
        ["insight_fixture",Instant.toISO(base.bounds.from),Instant.toISO(base.bounds.to),...steps]);
        expect(actual.value.counts).toEqual([oracle.rows[0].one,oracle.rows[0].two,oracle.rows[0].three]);
      }
      // Raw custom fields retain both namespaces and exact visit unions through packing.
      for (const unique of [false, true]) {
        const result = await engine[unique ? "uniquesBy" : "countsBy"]({
          ...base, by: ["property:url", "country", "property:country"], order: "desc", limit: 100,
          predicate: {op: "gte", field: {source: "property", key: "cost"}, value: 3},
        }, options);
        if (!result.ok) throw new Error(JSON.stringify(result.error));
        const oracle = await pool.query(`SELECT props->>'url' AS url, country, props->>'country' AS custom_country, ${unique ? "count(DISTINCT actor)" : "count(*)"}::int AS n FROM ${name}.oracle WHERE ${where} AND (props->>'cost')::int >= 3 GROUP BY props->>'url', country, props->>'country'`, parameters);
        const actual = result.value.rows.map((row) => [JSON.stringify(row.keys), row.value]).sort((a,b) => String(a[0]).localeCompare(String(b[0])));
        const expected = oracle.rows.map((row) => [JSON.stringify([row.url, row.country, row.custom_country]), row.n]).sort((a,b) => String(a[0]).localeCompare(String(b[0])));
        expect(actual).toEqual(expected);
      }
      const total = await engine.uniques(
        { ...base, wholeWindow: true },
        options,
      );
      if (!total.ok) throw new Error(JSON.stringify(total.error));
      const oracleTotal = await pool.query(
        `SELECT count(DISTINCT actor)::int AS n FROM ${name}.oracle WHERE ${where}`,
        parameters,
      );
      expect(total.value.buckets.map((bucket) => bucket.value)).toEqual([
        oracleTotal.rows[0].n,
      ]);
      for (const fields of [
        ["country"],
        ["country", "os_name"],
        ["country", "os_name", "locale"],
        ["event_type", "country"],
      ]) {
        for (const unique of [false, true]) {
          const result = await engine[unique ? "uniquesBy" : "countsBy"](
            { ...base, by: fields, order: "desc", limit: 100 },
            options,
          );
          if (!result.ok) throw new Error(JSON.stringify(result.error));
          const oracle = await pool.query(
            `SELECT ${fields.join(",")}, ${unique ? "count(DISTINCT actor)" : "count(*)"}::int AS n FROM ${name}.oracle WHERE ${where} GROUP BY ${fields.join(",")}`,
            parameters,
          );
          const actual = result.value.rows
            .map((row) => [JSON.stringify(row.keys ?? [row.key]), row.value])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
          const expected = oracle.rows
            .map((row) => [
              JSON.stringify(fields.map((field) => row[field])),
              row.n,
            ])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
          expect(actual).toEqual(expected);
        }
      }
      const trend = await engine.uniques({ ...base, by: "country" }, options);
      if (!trend.ok) throw new Error(JSON.stringify(trend.error));
      const oracle = await pool.query(
        `SELECT country,date_trunc('day',ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bucket,count(DISTINCT actor)::int AS n FROM ${name}.oracle WHERE ${where} GROUP BY country,bucket`,
        parameters,
      );
      for (const group of trend.value.groups ?? [])
        for (const bucket of group.buckets) {
          const row = oracle.rows.find(
            (row) =>
              row.country === group.key &&
              row.bucket.getTime() === Instant.toEpochMillis(bucket.start),
          );
          expect(bucket.value).toBe(row?.n ?? 0);
        }
      expect(trend.value.groups?.length).toBe(
        new Set(oracle.rows.map((row) => row.country)).size,
      );
    }, 30000);
  }
});
