import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { Duration } from "@counted/kernel";
import { createTestIdentity } from "./testing/harness";
import { migrateIdentity } from "./migrate";

const request = (path: string, body?: unknown, cookie?: string) => new Request(`http://localhost:3000/api/auth${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { "content-type": "application/json", "user-agent": "Fixture browser / never persist", ...(cookie ? { cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function sessionRemainsPrivate(identity: ReturnType<typeof createTestIdentity>) {
  const signedUp = await identity.http.handle(request("/sign-up/email", {
    email: `private-${crypto.randomUUID()}@example.test`, name: "Fixture", password: "test-password-123",
  }));
  expect(signedUp.status).toBe(200);
  const cookie = signedUp.headers.get("set-cookie")!;
  const context = await identity.auth.auth.$context;
  const sessions = await context.adapter.findMany<{ token: string; ipAddress: string | null; userAgent: string | null }>({ model: "session" });
  const session = sessions.at(-1)!;
  expect(session.ipAddress).toBeNull();
  expect(session.userAgent).toBeNull();
  expect(await identity.http.principal(new Headers({ cookie }))).not.toBeNull();

  // An update also cannot reintroduce metadata, and the session still resolves.
  await context.internalAdapter.updateSession(session.token, { ipAddress: "198.51.100.90", userAgent: "Updated fixture browser" });
  const response = await identity.http.handle(request("/get-session", undefined, cookie));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ session: { ipAddress: null, userAgent: null } });
  expect(await identity.http.principal(new Headers({ cookie }))).not.toBeNull();
  return session.token;
}

test("HTTP login and session updates never retain IP or user agent", async () => {
  await sessionRemainsPrivate(createTestIdentity());
});

test("memory rate limits still refuse concurrent attempts and do not create database counters", async () => {
  const tables: Record<string, unknown[]> = {};
  const identity = createTestIdentity({ database: { kind: "memory", tables }, signInRateLimit: { maxRequests: 2, window: Duration.minutes(1) } });
  const attempts = await Promise.all(Array.from({ length: 5 }, () => identity.http.handle(request("/sign-in/email", { email: "missing@example.test", password: "wrong-password" }))));
  expect(attempts.filter(response => response.status === 401)).toHaveLength(2);
  const limited = attempts.filter(response => response.status === 429);
  expect(limited).toHaveLength(3);
  expect(limited.every(response => Number(response.headers.get("x-retry-after")) > 0)).toBe(true);
  expect(tables.rateLimit).toBeUndefined();
});

const live = process.env.COUNTED_TEST_DATABASE_URL ? describe : describe.skip;
live("PostgreSQL session metadata cleanup", () => {
  const databaseName = `identity_privacy_${crypto.randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let database: Pool;
  let pool: Pool;
  let created = false;
  let identity: ReturnType<typeof createTestIdentity>;
  beforeAll(async () => {
    const url = new URL(process.env.COUNTED_TEST_DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Session privacy regression requires a local PostgreSQL server.");
    admin = new Pool({ connectionString: url.toString() });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    database = new Pool({ connectionString: url.toString() });
    // A fallback relation must survive both fresh boot and legacy auth cleanup.
    // The whole database belongs to this test, including this public fixture.
    await database.query('CREATE SCHEMA auth; CREATE TABLE public."rateLimit" (marker text); INSERT INTO public."rateLimit" VALUES (\'unrelated\')');
    pool = new Pool({ connectionString: url.toString(), options: "-c search_path=auth,public" });
    identity = createTestIdentity({ database: { kind: "postgres", pool } });
    await migrateIdentity(identity.config);
  });
  afterAll(async () => {
    await pool?.end();
    await database?.end();
    if (admin) {
      if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  });
  test("fresh database writes omit metadata and repeated boot clears old values without ending access", async () => {
    const token = await sessionRemainsPrivate(identity);
    expect((await pool.query(`SELECT to_regclass('auth."rateLimit"') AS name`)).rows[0]?.name).toBeNull();
    expect((await pool.query('SELECT * FROM public."rateLimit"')).rows).toEqual([{ marker: "unrelated" }]);
    const before = (await pool.query('SELECT token, "userId", "expiresAt" FROM "session" WHERE token = $1', [token])).rows[0];
    await pool.query('UPDATE "session" SET "ipAddress" = $1, "userAgent" = $2', ["198.51.100.90", "Old fixture browser"]);
    await pool.query('CREATE TABLE "rateLimit" (key text, count integer, "lastRequest" bigint)');
    await pool.query('INSERT INTO "rateLimit" VALUES ($1, 1, 0)', ["198.51.100.90|/sign-in/email"]);
    await migrateIdentity(identity.config);
    expect((await pool.query('SELECT "ipAddress", "userAgent" FROM "session"')).rows).toEqual([{ ipAddress: null, userAgent: null }]);
    expect((await pool.query('SELECT * FROM "rateLimit"')).rows).toEqual([]);
    expect((await pool.query('SELECT * FROM public."rateLimit"')).rows).toEqual([{ marker: "unrelated" }]);
    expect((await pool.query('SELECT token, "userId", "expiresAt" FROM "session" WHERE token = $1', [token])).rows[0]).toEqual(before);
    await migrateIdentity(identity.config);
    expect((await pool.query('SELECT count(*)::int AS count FROM "session"')).rows[0]?.count).toBe(1);
  });
});
