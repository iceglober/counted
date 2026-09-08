import { describe, expect, test } from "bun:test";
import { Instant, ProjectId } from "@counted/kernel";

import { LiticsEventRetention } from "./retention";
import type { WriteClient, WritePool } from "./sink";

const at = (iso: string): Instant => {
  const parsed = Instant.fromISO(iso);
  if (!parsed.ok) throw new Error(`bad fixture instant: ${iso}`);
  return parsed.value;
};

type Recorded = { readonly sql: string; readonly values: readonly unknown[] };

const fakePool = (
  onQuery: (sql: string, values: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>,
): { pool: WritePool; queries: Recorded[]; released: boolean[] } => {
  const queries: Recorded[] = [];
  const released: boolean[] = [];
  const client: WriteClient = {
    async query<R extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      const result = await onQuery(sql, values);
      return { rows: result.rows as R[], rowCount: result.rowCount };
    },
    release(destroy = false) {
      released.push(destroy);
    },
  };
  return { pool: { connect: async () => client }, queries, released };
};

const request = { project: ProjectId("prj_c"), before: at("2024-05-01T00:00:00Z") };

describe("LiticsEventRetention", () => {
  test("deletes whole segments before the instant, then staged rows, and reports events", async () => {
    const { pool, queries, released } = fakePool(async (sql) => {
      if (sql.startsWith("DELETE FROM analytics.events_segments")) return { rows: [{ n: 10_000 }, { n: 42 }], rowCount: 2 };
      if (sql.startsWith("DELETE FROM analytics.events ")) return { rows: [], rowCount: 7 };
      return { rows: [], rowCount: null };
    });
    const outcome = await new LiticsEventRetention({ pool }).purge(request);
    expect(outcome).toEqual({ ok: true, value: 10_049 });
    expect(queries.map((q) => q.sql.split(" ")[0])).toEqual(["BEGIN", "SET", "DELETE", "DELETE", "COMMIT"]);
    expect(queries[2]?.values).toEqual(["prj_c", "2024-05-01T00:00:00.000Z"]);
    expect(queries[2]?.sql).toContain("ts_max < $2");
    expect(queries[3]?.sql).toContain("ts < $2");
    expect(released).toEqual([false]);
  });

  test("a second purge finds nothing and says zero", async () => {
    const { pool } = fakePool(async () => ({ rows: [], rowCount: 0 }));
    expect(await new LiticsEventRetention({ pool }).purge(request)).toEqual({ ok: true, value: 0 });
  });

  test("a statement timeout is a Timeout, and the connection is destroyed", async () => {
    const { pool, released } = fakePool(async (sql) => {
      if (sql.startsWith("DELETE")) throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
      return { rows: [], rowCount: null };
    });
    const outcome = await new LiticsEventRetention({ pool, timeoutMs: 5 }).purge(request);
    expect(outcome).toEqual({ ok: false, error: { kind: "Timeout" } });
    expect(released).toEqual([true]);
  });

  test("anything else is StoreUnavailable with the message", async () => {
    const { pool } = fakePool(async (sql) => {
      if (sql.startsWith("DELETE")) throw new Error("connection terminated");
      return { rows: [], rowCount: null };
    });
    const outcome = await new LiticsEventRetention({ pool }).purge(request);
    expect(outcome).toEqual({ ok: false, error: { kind: "StoreUnavailable", detail: "connection terminated" } });
  });

  test("a pool that cannot connect is StoreUnavailable too", async () => {
    const pool: WritePool = { connect: async () => { throw new Error("pool exhausted"); } };
    const outcome = await new LiticsEventRetention({ pool }).purge(request);
    expect(outcome.ok).toBe(false);
  });
});
