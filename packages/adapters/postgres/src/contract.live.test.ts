/**
 * The ports contract suite, run against the real Postgres adapter.
 *
 * This is what #31 was written for. The same 21 cases that verified the
 * in-memory reference now verify SQL, unchanged — which is the whole argument
 * for keeping them framework-agnostic and adapter-agnostic. A failure here
 * means the adapter is wrong, not that the contract was never viable, because
 * the contract has already been shown to be satisfiable.
 */

import { afterAll, beforeAll, describe, test } from "bun:test";
import { Pool } from "pg";
import { ProjectId } from "@counted/domain";
import { allStoreContracts, type StoreFixture } from "@counted/ports/contract";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import { INDEX_STATEMENTS } from "./sql/indexes";
import { createPartitionSql, partitionsCovering } from "./partitions";
import { Instant } from "@counted/domain";
import { PostgresAnalyticalStore } from "./analytical-store";
import { PostgresEventWriter } from "./event-writer";

const ADMIN = process.env["TEST_ADMIN_URL"] ?? "postgres://counted:counted@localhost:5434/postgres";
const DB = "counted_v2_contract";
const URL = process.env["TEST_DATABASE_URL"] ?? `postgres://counted:counted@localhost:5434/${DB}`;
const PROJECT = ProjectId("11111111-1111-1111-1111-111111111111");
const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));

let pool: Pool | null = null;
let fixture: StoreFixture | null = null;
let reachable = false;
let reason = "";

beforeAll(async () => {
  try {
    const admin = new Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1_500 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    await admin.end();

    pool = new Pool({ connectionString: URL });
    for (const s of SCHEMA_STATEMENTS) await pool.query(s);
    for (const s of INDEX_STATEMENTS) await pool.query(s);

    // The contract seeds events across a wide range — the bucket differential
    // alone spans more than a year — so cover generously and let the default
    // partition catch anything beyond.
    for (const s of partitionsCovering(iso("2025-01-01T00:00:00Z"), iso("2029-01-01T00:00:00Z"), 1)) {
      await pool.query(createPartitionSql(s));
    }

    const store = new PostgresAnalyticalStore(pool, {
      engine: "postgres",
      approximateDistinct: false,
      partitioning: "declarative",
    });
    const writer = new PostgresEventWriter(pool);

    fixture = {
      store,
      writer,
      project: PROJECT,
      reset: async () => {
        await pool!.query("DELETE FROM events WHERE project_id = $1", [PROJECT]);
      },
    };
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

describe("ports contract — Postgres adapter", () => {
  for (const contractCase of allStoreContracts) {
    test(contractCase.name, async () => {
      if (!reachable) {
        if (process.env["REQUIRE_DB"] === "1") {
          throw new Error(`REQUIRE_DB=1 but no database was reachable: ${reason}`);
        }
        return;
      }
      await contractCase.run(fixture!);
    });
  }
});
