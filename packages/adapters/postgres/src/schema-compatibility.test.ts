import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { Pool } from "pg";
import { applySchema, DOMAIN_MIGRATIONS } from "./schema";
import { LegacySchemaNotSupported } from "./schema-compatibility";
import { describeLive } from "./testing";

const ADMIN_URL = process.env.COUNTED_TEST_DATABASE_URL ?? "postgres://counted:counted@127.0.0.1:5434/counted";
const DATABASE = `counted_schema_compat_${crypto.randomUUID().replaceAll("-", "")}`;

describeLive("legacy schema startup refusal", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
    try { await admin.query(`CREATE DATABASE ${DATABASE}`); }
    finally { await admin.end(); }
    const url = new URL(ADMIN_URL);
    url.pathname = `/${DATABASE}`;
    pool = new Pool({ connectionString: url.toString(), max: 2 });
  });

  beforeEach(async () => {
    await pool.query("DROP SCHEMA IF EXISTS auth CASCADE");
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
  });

  afterAll(async () => {
    await pool?.end();
    const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
    try { await admin.query(`DROP DATABASE IF EXISTS ${DATABASE}`); }
    finally { await admin.end(); }
  });

  test("an existing v2 database is refused before any DDL or customer row changes", async () => {
    // Historical storage signatures, with synthetic values only. The old
    // dashboard foreign key is otherwise incompatible with v3's text IDs.
    await pool.query(`
      CREATE TABLE workspaces (id uuid PRIMARY KEY, name text NOT NULL);
      CREATE TABLE projects (id uuid PRIMARY KEY, workspace_id uuid REFERENCES workspaces(id));
      CREATE TABLE dashboards (id uuid PRIMARY KEY, workspace_id uuid REFERENCES workspaces(id), tiles jsonb NOT NULL);
      CREATE TABLE schema_state (id int PRIMARY KEY, fingerprint text NOT NULL);
      INSERT INTO workspaces VALUES ('11111111-1111-4111-8111-111111111111','Existing fixture');
      INSERT INTO dashboards VALUES ('22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111','[{"title":"Existing fixture"}]');
      INSERT INTO schema_state VALUES (1,'legacy-fixture');
    `);
    const before = (await pool.query("SELECT * FROM dashboards")).rows;
    const failure = await applySchema(pool).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(LegacySchemaNotSupported);
    expect((failure as LegacySchemaNotSupported).markers).toEqual([
      "dashboards.id (uuid)", "dashboards.tiles (jsonb)", "projects.id (uuid)", "workspaces.id (uuid)",
    ]);
    expect((failure as Error).message).toContain("fresh, separate database");
    expect((await pool.query("SELECT * FROM dashboards")).rows).toEqual(before);
    expect((await pool.query("SELECT count(*)::int AS count FROM workspaces")).rows[0]?.count).toBe(1);
    expect((await pool.query("SELECT fingerprint FROM schema_state")).rows[0]?.fingerprint).toBe("legacy-fixture");
    expect((await pool.query(`SELECT to_regnamespace('auth') IS NULL AS no_auth,
      to_regclass('public.schema_migrations') IS NULL AS no_ledger,
      to_regclass('public.dashboard_tiles') IS NULL AS no_insights`)).rows[0])
      .toEqual({ no_auth: true, no_ledger: true, no_insights: true });
    await expect(applySchema(pool)).rejects.toThrow(LegacySchemaNotSupported);
  });

  test("casting IDs alone does not silently discard embedded dashboard content", async () => {
    await pool.query("CREATE TABLE dashboards (id text PRIMARY KEY, tiles jsonb NOT NULL)");
    const failure = await applySchema(pool).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(LegacySchemaNotSupported);
    expect((failure as LegacySchemaNotSupported).markers).toEqual(["dashboards.tiles (jsonb)"]);
    expect((await pool.query("SELECT to_regclass('public.workspaces') IS NULL AS unchanged")).rows[0]?.unchanged).toBe(true);
  });

  test("fresh and repeated v3 boots remain supported", async () => {
    expect((await applySchema(pool)).applied).toEqual(DOMAIN_MIGRATIONS.map(step => step.name));
    await pool.query("INSERT INTO workspaces (id,name,plan,payment_state) VALUES ('fixture','Existing fixture','free','none')");
    expect((await applySchema(pool)).applied).toEqual([]);
    expect((await pool.query("SELECT id FROM workspaces")).rows).toEqual([{ id: "fixture" }]);
  });
});
