import { describe, expect, test } from "bun:test";
import {
  ANALYTICS_POOL,
  INGEST_POOL,
  batchDeadlineFor,
  poolConfig,
  sessionOptions,
  settingsFor,
} from "./pool";
import { INDEX_STATEMENTS, UNINDEXED_BY_DESIGN } from "./sql/indexes";
import { SCHEMA_STATEMENTS } from "./sql/schema";

describe("every connection carries a statement timeout", () => {
  test("it is a session default, not something a query opts into", () => {
    // v1 set none at all. One runaway breakdown held a connection out of a
    // pool of 20 shared with ingestion. The query that forgets to set its own
    // timeout is precisely the one that will run away, so the safe value has
    // to be the default.
    for (const role of ["ingest", "analytics"] as const) {
      expect(sessionOptions(settingsFor(role))).toContain("statement_timeout=");
    }
  });

  test("a client dying mid-transaction cannot pin a connection forever", () => {
    expect(sessionOptions(INGEST_POOL)).toContain("idle_in_transaction_session_timeout=");
  });

  test("reads never wait on a lock", () => {
    expect(sessionOptions(ANALYTICS_POOL)).toContain("lock_timeout=");
  });
});

describe("ingestion and analytics do not share a pool", () => {
  test("they are separate, so a slow dashboard cannot stop events being written", () => {
    const ingest = poolConfig("postgres://x", "ingest");
    const analytics = poolConfig("postgres://x", "analytics");
    expect(ingest.max).not.toBe(analytics.max);
    expect(ingest.options).not.toBe(analytics.options);
  });

  test("ingest fails fast — a slow insert is a symptom, and 503 beats hanging", () => {
    // Failing fast lets the API answer 503 with Retry-After so the SDK's
    // on-device queue absorbs it, which is a better outcome than a request
    // hanging until the client gives up.
    expect(INGEST_POOL.statementTimeoutMs).toBeLessThan(ANALYTICS_POOL.statementTimeoutMs);
    expect(INGEST_POOL.connectionTimeoutMs).toBeLessThan(ANALYTICS_POOL.connectionTimeoutMs);
  });

  test("analytics gets more connections, ingest gets a guaranteed floor", () => {
    expect(ANALYTICS_POOL.max).toBeGreaterThan(INGEST_POOL.max);
    expect(INGEST_POOL.max).toBeGreaterThan(0);
  });

  test("each pool is identifiable in pg_stat_activity", () => {
    expect(poolConfig("postgres://x", "ingest").application_name).toBe("counted-ingest");
    expect(poolConfig("postgres://x", "analytics").application_name).toBe("counted-analytics");
  });
});

describe("the application gives up before the server does", () => {
  test("a batch deadline sits under the statement timeout", () => {
    for (const role of ["ingest", "analytics"] as const) {
      expect(batchDeadlineFor(role)).toBeLessThan(settingsFor(role).statementTimeoutMs);
      expect(batchDeadlineFor(role)).toBeGreaterThan(0);
    }
  });

  test("so a slow query becomes a stated timeout outcome, not a raw driver error", () => {
    // The port's StoreError has a `timeout` variant carrying its budget. That
    // is only reportable if the application notices first.
    expect(batchDeadlineFor("analytics")).toBe(24_000);
  });
});

describe("indexes", () => {
  test("all are declared on the parent, so partitions inherit them", () => {
    for (const sql of INDEX_STATEMENTS) {
      expect(sql).toContain("ON events");
      expect(sql).toContain("IF NOT EXISTS");
    }
  });

  test("the properties index exists at all — v1 had none", () => {
    // Every property filter and every property breakdown in v1 was a
    // sequential scan of the project's slice.
    const gin = INDEX_STATEMENTS.find((s) => s.includes("gin"));
    expect(gin).toBeDefined();
    expect(gin).toContain("jsonb_path_ops");
  });

  test("distinct-visit counting is served by a trailing visit_id", () => {
    // v1's index was (project_id, session_id) with no timestamp, so a
    // time-bounded distinct count could not use it.
    const idx = INDEX_STATEMENTS.find((s) => s.includes("visit_idx"));
    expect(idx).toContain("(project_id, occurred_at, visit_id)");
  });

  test("the person index is partial, because most rows have no person", () => {
    const idx = INDEX_STATEMENTS.find((s) => s.includes("person_time_idx"));
    expect(idx).toContain("WHERE person_id IS NOT NULL");
  });

  test("what is deliberately unindexed is written down", () => {
    expect(UNINDEXED_BY_DESIGN).toContain("numeric comparisons on customer properties");
  });
});

describe("schema statements", () => {
  test("the parent is partitioned and carries the dedup constraint", () => {
    const create = SCHEMA_STATEMENTS.find((s) => s.includes("CREATE TABLE IF NOT EXISTS events ("));
    expect(create).toContain("PARTITION BY RANGE (occurred_at)");
    expect(create).toContain("UNIQUE (project_id, idempotency_key, occurred_at)");
  });

  test("a default partition catches anything outside the months we made", () => {
    // Rows landing here mean partition creation has fallen behind. Better
    // stored and reported than rejected.
    expect(SCHEMA_STATEMENTS.some((s) => s.includes("PARTITION OF events DEFAULT"))).toBe(true);
  });

  test("the outbox indexes only undispatched rows", () => {
    const outbox = SCHEMA_STATEMENTS.find((s) => s.includes("outbox"));
    expect(outbox).toContain("WHERE dispatched_at IS NULL");
  });
});
