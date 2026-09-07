/**
 * The storage claim, asserted rather than assumed.
 *
 * Counted runs on stock PostgreSQL: no TimescaleDB, no `hll`, no `pg_cron`, no
 * `pg_partman`. CI runs against the official image with `EXPECT_PLAIN_POSTGRES=1`
 * set, and this is the test that flag turns on. Without the flag the suite still
 * reports what it found, so a developer running against a database that
 * happens to have extensions installed learns that rather than getting a
 * failure about their machine.
 *
 * What is proven here is that the schema *this package* applies needs nothing
 * beyond `plpgsql`. The analytics engine proves the same for its own schema in
 * its own repository, and the journey suite proves both together against the
 * database the API actually boots on.
 */

import { afterAll, expect, test } from "bun:test";
import { closeDatabase, describeLive, liveDatabase } from "./testing";

const EXPECT_PLAIN = process.env["EXPECT_PLAIN_POSTGRES"] === "1";

describeLive("stock Postgres", () => {
  afterAll(closeDatabase);

  test(
    EXPECT_PLAIN
      ? "the only extension in the application database is plpgsql"
      : "which extensions the application database has (informational)",
    async () => {
      const pool = await liveDatabase();
      const { rows } = await pool.query<{ extname: string }>(
        "SELECT extname FROM pg_extension ORDER BY extname",
      );
      const names = rows.map((row) => row.extname);
      if (EXPECT_PLAIN) {
        expect(names).toEqual(["plpgsql"]);
      } else {
        console.log(`extensions present: ${names.join(", ")}`);
        expect(names).toContain("plpgsql");
      }
    },
  );
});
