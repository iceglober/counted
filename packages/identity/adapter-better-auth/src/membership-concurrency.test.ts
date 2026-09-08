import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { createTestIdentity } from "./testing/harness";
import { migrateIdentity } from "./migrate";
import { Instant } from "@counted/kernel";

async function competingRemovals(identity: ReturnType<typeof createTestIdentity>) {
  const workspace = await identity.givenWorkspace("Concurrent owners");
  const first = await identity.givenMember(workspace, "owner");
  const second = await identity.givenMember(workspace, "owner");
  const outcomes = await Promise.all([identity.memberships.remove(workspace, first), identity.memberships.changeRole(workspace, second, "member")]);
  expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
  expect(outcomes.filter((result) => !result.ok && result.error.kind === "LastOwner")).toHaveLength(1);
  expect((await identity.memberships.membersOf(workspace)).filter((member) => member.role === "owner")).toHaveLength(1);
}

test("concurrent owner changes preserve an owner in the memory contract adapter", async () => {
  await competingRemovals(createTestIdentity());
});

const live = process.env.COUNTED_TEST_DATABASE_URL ? describe : describe.skip;
live("PostgreSQL owner serialization", () => {
  const schema = `identity_owner_test_${crypto.randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let pool: Pool;
  let identity: ReturnType<typeof createTestIdentity>;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.COUNTED_TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: process.env.COUNTED_TEST_DATABASE_URL, options: `-c search_path=${schema},public`, max: 4 });
    identity = createTestIdentity({ database: { kind: "postgres", pool } });
    await migrateIdentity(identity.config);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
  });
  test("two connections cannot concurrently remove or demote the last owners", async () => {
    await competingRemovals(identity);
  });
  test("the PostgreSQL directory crosses stable page boundaries and returns a real owner", async () => {
    const workspace = await identity.givenWorkspace("Directory owner");
    const owner = await identity.givenMember(workspace, "owner");
    const first = await identity.organizations.page({ since: Instant.EPOCH, cursor: null, limit: 1 });
    expect(first.cursor).not.toBeNull();
    const second = await identity.organizations.page({ since: Instant.EPOCH, cursor: first.cursor, limit: 1 });
    expect(second.items[0]?.workspace).toBe(workspace);
    expect(second.items[0]?.owner).toBe(owner);
    expect(second.cursor).toBeNull();
  });
});
