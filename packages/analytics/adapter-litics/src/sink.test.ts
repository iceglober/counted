import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { Instant, PersonId, ProjectId, VisitId } from "@counted/kernel";
import { admitCountry, dedupKey, type AdmittedEvent } from "@counted/ingestion-domain";

import { LiticsEventSink, toTrackEvent, writeStatement, type WriteClient, type WritePool, PACK_CHANNEL } from "./sink";

/**
 * A real `pg.Pool` has to keep fitting the narrow shape the sink declares.
 * Nothing else checks it, and the day it stops fitting is the day the sink
 * silently becomes untestable against the real driver.
 */
const _poolFits: (pool: Pool) => WritePool = (pool) => pool;

const at = (iso: string): Instant => {
  const parsed = Instant.fromISO(iso);
  if (!parsed.ok) throw new Error(`bad fixture instant: ${iso}`);
  return parsed.value;
};

const PROJECT = ProjectId("prj_1");

const event = (over: Partial<AdmittedEvent> = {}): AdmittedEvent => ({
  name: "app_started",
  visit: VisitId("vis_1"),
  person: null,
  occurredAt: at("2024-05-01T10:00:00Z"),
  receivedAt: at("2024-05-01T10:00:01Z"),
  dedupKey: null,
  properties: {},
  system: {
    os_name: "ios",
    os_name_raw: null,
    os_version: "17.4",
    locale: "en-GB",
    app_version: "1.2.0",
    device_model: "iPhone15,2",
    sdk_version: "0.3.1",
    country: admitCountry("NZ"),
  },
  ...over,
});

type Recorded = { readonly sql: string; readonly values: readonly unknown[] };

const fakePool = (
  onQuery: (sql: string, values: readonly unknown[]) => Promise<{ rowCount: number | null; rows?: Record<string, unknown>[] }>,
): { pool: WritePool; queries: Recorded[]; released: boolean[] } => {
  const queries: Recorded[] = [];
  const released: boolean[] = [];
  const client: WriteClient = {
    async query<R extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      const result = await onQuery(sql, values);
      return { rows: (result.rows ?? []) as R[], rowCount: result.rowCount };
    },
    release(destroy = false) {
      released.push(destroy);
    },
  };
  return { pool: { connect: async () => client }, queries, released };
};

const ok = async (sql: string, values: readonly unknown[]): Promise<{ rowCount: number | null }> => ({
  rowCount: sql.startsWith("INSERT") ? (JSON.parse(String(values[0])) as unknown[]).length : null,
});

describe("toTrackEvent", () => {
  test("the actor is the visit, and the tenant is the project", () => {
    const statement = writeStatement(PROJECT, [event()]);
    const rows = JSON.parse(statement.parameters[0] as string) as { actor: string; tenant: string }[];
    expect(rows[0]?.actor).toBe("vis_1");
    expect(rows[0]?.tenant).toBe("prj_1");
  });

  /**
   * The dimension columns are the SDK's six system properties. A dimension the
   * event has no value for must arrive as an explicit null, not be absent: the
   * generated statement reads `e->>'<name>'` per dimension, and an absent key
   * and a null key differ nowhere else.
   */
  test("every declared dimension is present, null when the SDK sent nothing", () => {
    const converted = toTrackEvent(
      event({
        system: {
          os_name: "android",
          os_name_raw: null,
          os_version: null,
          locale: null,
          app_version: null,
          device_model: null,
          sdk_version: null,
          // The address could not be placed — a private range, a proxy that
          // wrote no header. Null, and it must reach the statement as one.
          country: null,
        },
      }),
    );
    expect(converted.dims).toEqual({
      os_name: "android",
      os_version: null,
      locale: null,
      app_version: null,
      device_model: null,
      sdk_version: null,
      country: null,
    });
  });

  /**
   * `country` is the one dimension no SDK sends: it is derived from the request
   * address at ingest and the address is discarded. By the time an event
   * reaches here it is an ordinary column, and this is the test that says the
   * value made it from `SystemProperties` into the statement rather than being
   * dropped as an unrecognised field.
   */
  test("country reaches the dimension map, and is the only geography that does", () => {
    const converted = toTrackEvent(event());
    expect(converted.dims?.["country"]).toBe("NZ");
    // Nothing address-shaped travels with it: not in the dims, not in props.
    expect(JSON.stringify(converted)).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/);
  });

  /**
   * `ts` is `occurredAt`. Re-stamping on arrival is what would make a week of
   * events buffered by an offline device all land in the same minute.
   */
  test("the timestamp is when it happened, not when we heard about it", () => {
    const converted = toTrackEvent(
      event({
        occurredAt: at("2024-05-01T10:00:00Z"),
        receivedAt: at("2024-05-08T09:00:00Z"),
      }),
    );
    expect((converted.ts as Date).toISOString()).toBe("2024-05-01T10:00:00.000Z");
  });

  /**
   * The actor is the visit, so a person has no column. Losing it entirely
   * would make the person-basis stream `config.ts` describes impossible to
   * backfill, so it goes in `props` under a name a client cannot collide with.
   */
  test("a person and the raw OS name survive in props, under reserved keys", () => {
    const converted = toTrackEvent(
      event({
        person: PersonId("per_9"),
        properties: { person: "not mine", plan: "pro" },
        system: { ...event().system, os_name_raw: "iPhone OS" },
      }),
    );
    expect(converted.props).toEqual({
      person: "not mine",
      plan: "pro",
      $person: "per_9",
      $os_name_raw: "iPhone OS",
    });
  });

  test("no eventId is supplied, so the statement mints one", () => {
    // `dedupKey` is whatever the SDK chose and is not a UUID; casting it to
    // `uuid` would be a 22P02 on the hot path. Admission already deduplicated.
    expect(toTrackEvent(event()).eventId).toBeUndefined();
  });
});

describe("LiticsEventSink", () => {
  test("one batch is one statement, whatever the batch size", async () => {
    const { pool, queries } = fakePool(ok);
    const sink = new LiticsEventSink({ pool });
    const outcome = await sink.writeBatch(PROJECT, [event(), event(), event()]);

    expect(outcome.ok).toBe(true);
    const inserts = queries.filter((q) => q.sql.startsWith("INSERT"));
    expect(inserts).toHaveLength(1);
    expect(JSON.parse(inserts[0]?.values[0] as string)).toHaveLength(3);
  });

  test("an empty batch touches no connection", async () => {
    const { pool, queries } = fakePool(ok);
    const outcome = await new LiticsEventSink({ pool }).writeBatch(PROJECT, []);
    expect(outcome).toEqual({ ok: true, value: { written: 0, writtenIndices: [], deduplicated: 0 } });
    expect(queries).toEqual([]);
  });

  /**
   * The write timeout is `SET LOCAL`, never `SET`. A bare `SET` would leave the
   * timeout on a pooled connection for whoever picks it up next — a setting
   * discovered months later on an unrelated query.
   */
  test("the statement timeout is scoped to the transaction", async () => {
    const { pool, queries } = fakePool(ok);
    await new LiticsEventSink({ pool, writeTimeoutMs: 250 }).writeBatch(PROJECT, [event()]);
    expect(queries.map((q) => q.sql)).toContain("SET LOCAL statement_timeout = 250");
  });

  test("the pack notification is inside the write transaction, after the insert", async () => {
    // Delivered on COMMIT, so a rolled-back batch wakes nobody; after the
    // INSERT, so the compactor never wakes to an empty staging table.
    const { pool, queries } = fakePool(ok);
    await new LiticsEventSink({ pool }).writeBatch(PROJECT, [event()]);
    const order = queries.map((q) => q.sql);
    const begin = order.indexOf("BEGIN");
    const insert = order.findIndex((sql) => sql.startsWith("INSERT"));
    const notify = order.findIndex((sql) => sql.startsWith("SELECT pg_notify"));
    const commit = order.indexOf("COMMIT");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(begin);
    expect(notify).toBeGreaterThan(insert);
    expect(commit).toBeGreaterThan(notify);
    expect(queries[notify]?.values).toEqual([PACK_CHANNEL, "prj_1"]);
  });

  test("a cancelled statement is a Timeout, and the connection is destroyed", async () => {
    const { pool, released } = fakePool(async (sql) => {
      if (sql.startsWith("INSERT")) throw Object.assign(new Error("canceled"), { code: "57014" });
      return { rowCount: null };
    });
    const outcome = await new LiticsEventSink({ pool }).writeBatch(PROJECT, [event()]);
    expect(outcome).toEqual({ ok: false, error: { kind: "Timeout" } });
    // `true` destroys the connection instead of returning it: an in-flight
    // query only actually stops when Postgres notices the socket close.
    expect(released).toEqual([true]);
  });


  test("a missing analytics schema says to run the migrations", async () => {
    const { pool } = fakePool(async (sql) => {
      if (sql.startsWith("INSERT")) {
        throw Object.assign(new Error(`relation "analytics.events" does not exist`), { code: "42P01" });
      }
      return { rowCount: null };
    });
    const outcome = await new LiticsEventSink({ pool }).writeBatch(PROJECT, [event()]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.kind).toBe("SinkUnavailable");
    expect(outcome.error).toHaveProperty("detail", expect.stringContaining("litics migrations"));
  });

  test("a partial insert rolls back rather than acknowledging an incomplete batch", async () => {
    const { pool, released, queries } = fakePool(async (sql) =>
      sql.startsWith("INSERT") ? { rowCount: 2 } : { rowCount: null },
    );
    const outcome = await new LiticsEventSink({ pool }).writeBatch(PROJECT, [event(), event(), event()]);
    expect(outcome.ok).toBe(false);
    expect(released).toEqual([true]);
    expect(queries.some((query) => query.sql === "COMMIT")).toBe(false);
  });

  test("durable repeats retain their input positions, while unkeyed events always write", async () => {
    const { pool, queries } = fakePool(async (sql, values) => {
      if (sql.includes("public.ingest_receipts")) {
        const keys = values[1] as string[];
        return { rowCount: 1, rows: [{ digest: keys[0] }] };
      }
      return ok(sql, values);
    });
    const key = dedupKey("stable-sdk-key", event().occurredAt);
    const outcome = await new LiticsEventSink({ pool }).writeBatch(PROJECT, [event({dedupKey:key}), event({dedupKey:key}), event()]);
    expect(outcome).toEqual({ok:true, value:{written:2, writtenIndices:[0,2], deduplicated:1}});
    const reservation = queries.find((query) => query.sql.includes("public.ingest_receipts"))!;
    expect((reservation.values[1] as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(reservation.values)).not.toContain("stable-sdk-key");
    expect(queries.filter((query) => query.sql.startsWith("INSERT"))).toHaveLength(2);
  });

  test("an entirely repeated batch commits its receipt without waking the packer", async () => {
    const {pool, queries} = fakePool(async () => ({rowCount:0}));
    const outcome = await new LiticsEventSink({pool}).writeBatch(PROJECT, [event({dedupKey:dedupKey("old", event().occurredAt)})]);
    expect(outcome).toEqual({ok:true, value:{written:0, writtenIndices:[], deduplicated:1}});
    expect(queries.map((query) => query.sql)).toContain("COMMIT");
    expect(queries.some((query) => query.sql.startsWith("SELECT pg_notify"))).toBe(false);
  });
});
