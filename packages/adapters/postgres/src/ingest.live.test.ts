/**
 * Ingestion against a real PostgreSQL.
 *
 * Two things here can only be proven against the real database: that
 * `ON CONFLICT DO NOTHING RETURNING` names exactly the rows that were written
 * (which is what lets a receipt say `deduplicated` per event), and that the
 * quota lookup counts the right rows.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { Entitlement, Instant, ProjectId, Quota, VisitId, WorkspaceId } from "@counted/domain";
import type { WritableEvent } from "@counted/ports";
import { createDatabase, type LiveDatabase } from "./testing/database";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import { CONTROL_PLANE_STATEMENTS } from "./sql/control-plane";
import { createPartitionSql, partitionsCovering } from "./partitions";
import { PostgresEventWriter } from "./event-writer";
import { createQuotaService } from "./quota";

const DB = "counted_v2_ingest";

const WS = WorkspaceId("22222222-2222-2222-2222-222222222222");
const PRJ = ProjectId("33333333-3333-3333-3333-333333333333");
const OTHER_PRJ = ProjectId("33333333-3333-3333-3333-333333333334");
const UNCLAIMED = ProjectId("33333333-3333-3333-3333-333333333399");

let pool: Pool | null = null;
let live: LiveDatabase | null = null;
let writer: PostgresEventWriter | null = null;
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

/** Inside the current month, so the quota query's partition pruning applies. */
const inThisMonth = (dayOffset = 0): Instant => {
  const now = new Date();
  return Instant.fromEpochMillis(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1 + dayOffset, 12, 0, 0));
};

const row = (over: Partial<WritableEvent> = {}): WritableEvent => ({
  project: PRJ,
  name: "page_view",
  occurredAt: inThisMonth(),
  visit: VisitId("v1"),
  person: null,
  idempotencyKey: "k1",
  properties: {},
  system: {},
  ...over,
});

beforeAll(async () => {
  try {
    live = await createDatabase(DB);
    pool = live.pool;
    for (const s of SCHEMA_STATEMENTS) await pool.query(s);
    for (const s of CONTROL_PLANE_STATEMENTS) await pool.query(s);
    for (const spec of partitionsCovering(
      Instant.fromEpochMillis(Date.parse("2025-01-01T00:00:00Z")),
      Instant.fromEpochMillis(Date.parse("2029-01-01T00:00:00Z")),
      1,
    )) {
      await pool.query(createPartitionSql(spec));
    }
    writer = new PostgresEventWriter(pool);

    await pool.query(`INSERT INTO workspaces (id, name, plan, payment_state) VALUES ($1,'Acme','free','none')`, [WS]);
    await pool.query(`INSERT INTO projects (id, workspace_id, name) VALUES ($1,$2,'Web'), ($3,$2,'Docs')`, [
      PRJ,
      WS,
      OTHER_PRJ,
    ]);
    await pool.query(`INSERT INTO projects (id, workspace_id, name) VALUES ($1,NULL,'Unclaimed')`, [UNCLAIMED]);
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

const clean = async () => {
  await pool!.query("TRUNCATE events");
};

describe("the RETURNING set names exactly the rows that were written", () => {
  dbTest("a fresh batch returns every row", async () => {
    await clean();
    const receipt = await writer!.append([row({ idempotencyKey: "a" }), row({ idempotencyKey: "b" })], {
      deadlineMs: 5_000,
    });
    expect(receipt.accepted).toBe(2);
    expect(receipt.written.map((w) => w.idempotencyKey).sort()).toEqual(["a", "b"]);
  });

  dbTest("a resent batch returns nothing, and says so", async () => {
    await clean();
    const events = [row({ idempotencyKey: "a" })];
    await writer!.append(events, { deadlineMs: 5_000 });
    const second = await writer!.append(events, { deadlineMs: 5_000 });

    // At-least-once delivery is only safe if a retry is visibly a duplicate.
    expect(second.accepted).toBe(0);
    expect(second.deduplicated).toBe(1);
    expect(second.written).toHaveLength(0);
  });

  dbTest("a partial resend names only the new row", async () => {
    // This is the case the receipt's per-event `deduplicated` depends on, and
    // the one a count alone cannot express.
    await clean();
    await writer!.append([row({ idempotencyKey: "old" })], { deadlineMs: 5_000 });
    const mixed = await writer!.append([row({ idempotencyKey: "old" }), row({ idempotencyKey: "new" })], {
      deadlineMs: 5_000,
    });

    expect(mixed.written.map((w) => w.idempotencyKey)).toEqual(["new"]);
    expect(mixed.accepted).toBe(1);
    expect(mixed.deduplicated).toBe(1);
  });

  dbTest("the returned instant round-trips, so the caller can match on it", async () => {
    // The dedup identity is key plus instant; a millisecond lost in the round
    // trip would make every event look like a duplicate.
    await clean();
    const at = inThisMonth(2);
    const receipt = await writer!.append([row({ idempotencyKey: "t", occurredAt: at })], { deadlineMs: 5_000 });
    expect(receipt.written[0]!.occurredAt).toBe(at);
  });

  dbTest("only one row lands however many times it is sent", async () => {
    await clean();
    for (let i = 0; i < 5; i++) await writer!.append([row({ idempotencyKey: "same" })], { deadlineMs: 5_000 });
    const { rows } = await pool!.query<{ n: string }>("SELECT count(*)::text AS n FROM events");
    expect(rows[0]!.n).toBe("1");
  });

  dbTest("the same event twice in one batch is collapsed before the insert", async () => {
    // Relying on ON CONFLICT alone would leave the counts ambiguous: the
    // conflict check runs against the table's snapshot, not against rows
    // earlier in the same statement.
    await clean();
    const receipt = await writer!.append([row({ idempotencyKey: "dup" }), row({ idempotencyKey: "dup" })], {
      deadlineMs: 5_000,
    });
    expect(receipt.written).toHaveLength(1);
    const { rows } = await pool!.query<{ n: string }>("SELECT count(*)::text AS n FROM events");
    expect(rows[0]!.n).toBe("1");
  });
});

describe("quota counts the workspace, not the project", () => {
  const service = () => createQuotaService(pool!, { ttlMs: 0 });

  dbTest("an empty project is well under the free allowance", async () => {
    await clean();
    const decision = await service().decide(PRJ);
    expect(decision.kind).toBe("accept");
    expect(decision.used).toBe(0);
  });

  dbTest("events in a sibling project count against the same allowance", async () => {
    // The allowance belongs to the workspace. Counting per project would let
    // anyone stay free forever by making more projects.
    await clean();
    await writer!.append(
      [row({ idempotencyKey: "a" }), row({ project: OTHER_PRJ, idempotencyKey: "b" })],
      { deadlineMs: 5_000 },
    );
    expect((await service().decide(PRJ)).used).toBe(2);
  });

  dbTest("an unclaimed project gets the free allowance rather than nothing", async () => {
    // It can be tried out before it is adopted, which is the point of an
    // unclaimed project.
    await clean();
    const decision = await service().decide(UNCLAIMED);
    expect(Quota.accepts(decision)).toBe(true);
    expect(decision.limit).toBe(Entitlement.none().limits.eventsPerMonth);
  });

  dbTest("a project that does not exist gets the free allowance, not a crash", async () => {
    const decision = await service().decide(ProjectId("44444444-4444-4444-4444-444444444444"));
    expect(Quota.accepts(decision)).toBe(true);
  });

  dbTest("the plan on the workspace is what decides the limit", async () => {
    await clean();
    await pool!.query(`UPDATE workspaces SET plan='pro', payment_state='active' WHERE id=$1`, [WS]);
    const pro = await service().decide(PRJ);
    await pool!.query(`UPDATE workspaces SET plan='free', payment_state='none' WHERE id=$1`, [WS]);
    const free = await service().decide(PRJ);

    expect(pro.limit).not.toBe(free.limit);
  });

  dbTest("an unrecognised plan falls back to free rather than handing out pro", async () => {
    // A typo in a column must not give away a paid allowance, and it must not
    // stop ingestion either.
    await clean();
    await pool!.query(`UPDATE workspaces SET plan='enterprise-plus', payment_state='active' WHERE id=$1`, [WS]);
    const decision = await service().decide(PRJ);
    await pool!.query(`UPDATE workspaces SET plan='free', payment_state='none' WHERE id=$1`, [WS]);

    expect(decision.limit).toBe(Entitlement.none().limits.eventsPerMonth);
  });

  dbTest("the cache is used, and expires", async () => {
    await clean();
    const cached = createQuotaService(pool!, { ttlMs: 60_000 });
    expect((await cached.decide(PRJ)).used).toBe(0);

    await writer!.append([row({ idempotencyKey: "later" })], { deadlineMs: 5_000 });
    // Still the cached answer — this runs on the ingest hot path and a
    // month-wide count per request is not viable.
    expect((await cached.decide(PRJ)).used).toBe(0);
    // A fresh service sees the truth, which is what expiry amounts to.
    expect((await createQuotaService(pool!, { ttlMs: 0 }).decide(PRJ)).used).toBe(1);
  });
});
