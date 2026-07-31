import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { createDatabase, type LiveDatabase } from "./testing/database";
import { Instant, TimeAxis, Window } from "@counted/domain";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import {
  BucketContractViolation,
  bootStore,
  describeBoot,
  probeCapabilities,
  verifyBucketContract,
} from "./capabilities";

const DB = "counted_v2_capabilities";

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

beforeAll(async () => {
  try {
    live = await createDatabase(DB);
    pool = live.pool;
    for (const s of SCHEMA_STATEMENTS) await pool.query(s);
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

describe("the store is probed, not assumed", () => {
  dbTest("it reports the engine and how events are partitioned", async () => {
    const caps = await probeCapabilities(pool!);
    expect(caps.engine).toContain("postgres");
    // The schema creates a declaratively partitioned table, with no extension.
    expect(caps.partitioning).toBe("declarative");
  });

  dbTest("a missing extension is a reported fact, not a runtime surprise", async () => {
    // v1 assumed TimescaleDB. On plain Postgres its migration failed silently
    // on every boot and every timeseries query threw at runtime, which users
    // saw as empty charts.
    const caps = await probeCapabilities(pool!);
    expect(typeof caps.timescale).toBe("boolean");
    expect(typeof caps.approximateDistinct).toBe("boolean");
  });

  dbTest("nothing here USES TimescaleDB, whether or not it is installed", async () => {
    const caps = await probeCapabilities(pool!);

    // The claim that matters is not "the extension is absent" — it is "we do
    // not use it". This dev container happens to be the timescale image, so
    // the extension is present; `events` is still a declaratively partitioned
    // table rather than a hypertable, and no query calls time_bucket.
    //
    // Proving the absent case needs a plain postgres image, which is #41's
    // job. Asserting `timescale === false` here would have made this test
    // pass for the wrong reason on a plain host and fail for the wrong reason
    // on this one.
    expect(caps.partitioning).toBe("declarative");
    expect(caps.partitioning).not.toBe("hypertable");
  });
});

describe("the bucket contract is verified against the live database", () => {
  dbTest("it agrees with the domain across grains, boundaries and DST", async () => {
    const check = await verifyBucketContract(pool!);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.checked).toBeGreaterThan(40);
  });

  dbTest("booting returns a report worth logging", async () => {
    const report = await bootStore(pool!);
    const line = describeBoot(report);
    expect(line).toContain("postgres");
    expect(line).toContain("partitioning=declarative");
    expect(line).toMatch(/timescale=(present|absent)/);
    expect(line).toContain("bucketContract=verified");
  });

  dbTest("the check would actually catch a disagreement", async () => {
    // Prove the assertion has teeth rather than trusting that it does. Ask the
    // database to bucket against edges shifted by an hour and confirm its
    // answers stop matching the domain's.
    const window = Window.between(
      Instant.fromEpochMillis(Date.parse("2026-01-01T00:00:00Z")),
      Instant.fromEpochMillis(Date.parse("2026-01-10T00:00:00Z")),
    );
    const axis = TimeAxis.build(window, "day", Instant.fromEpochMillis(Date.parse("2026-01-10T00:00:00Z")));
    const shifted = TimeAxis.edgeMillis(axis).map((ms) => new Date(ms + 3_600_000));
    const at = Instant.fromEpochMillis(Date.parse("2026-01-03T00:30:00Z"));

    const row = (
      await pool!.query(`SELECT width_bucket($1::timestamptz, $2::timestamptz[]) - 1 AS ix`, [
        Instant.toDate(at),
        shifted,
      ])
    ).rows[0];

    // Against the correct edges the domain and the store agree; against
    // shifted ones they must not, or the check could never fail.
    expect(Number(row.ix)).not.toBe(TimeAxis.assign(axis, at));
  });

  dbTest("a violation refuses the boot rather than degrading quietly", async () => {
    const error = new BucketContractViolation([
      { grain: "day", instant: "2026-01-03T00:30:00.000Z", domainSays: 2, storeSays: 1 },
    ]);
    expect(error.message).toContain("Refusing to start");
    expect(error.message).toContain("domain says 2, store says 1");
    expect(error.name).toBe("BucketContractViolation");
  });
});

describe("timezone independence", () => {
  dbTest("a non-UTC session TimeZone does not move a boundary", async () => {
    // A common real misconfiguration. Everything is stored and compared as
    // timestamptz, so the session zone must be irrelevant — if it were not,
    // every chart would shift for whoever set it.
    const skewed = new Pool({ connectionString: live!.url, options: "-c TimeZone=America/New_York" });
    try {
      const check = await verifyBucketContract(skewed);
      expect(check.ok).toBe(true);
    } finally {
      await skewed.end();
    }
  });
});

describe("the plain-Postgres claim", () => {
  dbTest("on a stock image the extension really is absent", async () => {
    // Guarded, because the local dev container is the timescale image and
    // would fail this for the right reason. CI sets EXPECT_PLAIN_POSTGRES=1
    // against a stock postgres:17 service, which is where the claim behind the
    // whole storage decision — no extension required — is actually proven.
    if (process.env["EXPECT_PLAIN_POSTGRES"] !== "1") return;

    const caps = await probeCapabilities(pool!);
    expect(caps.timescale).toBe(false);
    expect(caps.partitioning).toBe("declarative");

    // And bucketing still agrees, which is the part that would break first if
    // anything had quietly depended on time_bucket.
    const check = await verifyBucketContract(pool!);
    expect(check.ok).toBe(true);
  });
});
