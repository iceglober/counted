/**
 * The authorization lookups, against a real PostgreSQL.
 *
 * The rules are proven in the domain with no I/O. What is left to get wrong is
 * *these queries* — and a wrong join here makes a correct rule give a wrong
 * answer, which is the worst failure mode in the system. So each one is
 * exercised against real rows.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { createDatabase, type LiveDatabase } from "./testing/database";
import {
  AccountId,
  DashboardId,
  Instant,
  ProjectId,
  WorkspaceId,
  type Resource,
} from "@counted/domain";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import { CONTROL_PLANE_STATEMENTS } from "./sql/control-plane";
import { createAccessResolver } from "./access-resolver";

const DB = "counted_v2_access";

const t0 = Instant.fromEpochMillis(Date.parse("2026-02-01T00:00:00Z"));
const later = Instant.fromEpochMillis(Date.parse("2026-06-01T00:00:00Z"));

const WS = WorkspaceId("22222222-2222-2222-2222-222222222222");
const OTHER_WS = WorkspaceId("22222222-2222-2222-2222-222222222299");
const PRJ = ProjectId("33333333-3333-3333-3333-333333333333");
const UNCLAIMED = ProjectId("33333333-3333-3333-3333-333333333399");
const DASH = DashboardId("55555555-5555-5555-5555-555555555555");
const MON = "66666666-6666-6666-6666-666666666666";
const alice = AccountId("acc_alice");
const nobody = AccountId("acc_nobody");

let pool: Pool | null = null;
let live: LiveDatabase | null = null;
let resolver: ReturnType<typeof createAccessResolver> | null = null;
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
    for (const s of CONTROL_PLANE_STATEMENTS) await pool.query(s);
    resolver = createAccessResolver(pool);

    await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1,'Acme'), ($2,'Other')`, [WS, OTHER_WS]);
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, account_id, role, since) VALUES ($1,$2,'admin',now())`,
      [WS, alice],
    );
    await pool.query(`INSERT INTO projects (id, workspace_id, name) VALUES ($1,$2,'Web')`, [PRJ, WS]);
    // Deliberately unclaimed: workspace_id IS NULL.
    await pool.query(`INSERT INTO projects (id, workspace_id, name) VALUES ($1,NULL,'Unclaimed')`, [UNCLAIMED]);
    await pool.query(`INSERT INTO dashboards (id, workspace_id, name, tiles) VALUES ($1,$2,'Main',$3)`, [
      DASH,
      WS,
      JSON.stringify([{ id: "t1", project: PRJ }, { id: "t2", project: PRJ }]),
    ]);
    await pool.query(
      `INSERT INTO monitors (id, project_id, name, analysis, threshold, cooldown_ms)
       VALUES ($1,$2,'Spike','{}'::jsonb,'{}'::jsonb,0)`,
      [MON, PRJ],
    );

    const cred = (id: string, kind: string, digest: string, scopes: string[], project: string, extra = "NULL, NULL") =>
      pool!.query(
        `INSERT INTO credentials (id, project_id, kind, label, digest, prefix, scopes, issued_at, expires_at, revoked_at)
         VALUES ($1,$2,$3,'k',$4,'p_1',$5::jsonb, now(), ${extra})`,
        [id, project, kind, digest, JSON.stringify(scopes)],
      );
    await cred("44444444-0000-0000-0000-000000000001", "ingest", "d_ingest", ["events:write"], PRJ);
    await cred("44444444-0000-0000-0000-000000000002", "service", "d_service", ["queries:run"], PRJ);
    await cred("44444444-0000-0000-0000-000000000003", "service", "d_revoked", ["queries:run"], PRJ, "NULL, now()");
    await cred(
      "44444444-0000-0000-0000-000000000004",
      "service",
      "d_expired",
      ["queries:run"],
      PRJ,
      `'2026-03-01T00:00:00Z', NULL`,
    );
    await cred("44444444-0000-0000-0000-000000000005", "service", "d_unclaimed", ["queries:run"], UNCLAIMED);
    await pool.query(
      `UPDATE dashboards SET share_digest = 'd_share', share_expires_at = '2026-12-01T00:00:00Z' WHERE id = $1`,
      [DASH],
    );

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

const principal = (digest: string, kind: "ingest" | "service" | "share" | null, at = t0) =>
  resolver!.principalFor({ digest, claimedKind: kind }, at);

describe("resolving a presented credential", () => {
  dbTest("an ingest key becomes an ingest principal bound to its project", async () => {
    const p = await principal("d_ingest", "ingest");
    expect(p.kind).toBe("ingest");
    if (p.kind === "ingest") {
      expect(p.project).toBe(PRJ);
      expect(p.scopes).toEqual(["events:write"]);
    }
  });

  dbTest("a service key carries its workspace, its project and its own scopes", async () => {
    const p = await principal("d_service", "service");
    expect(p.kind).toBe("service");
    if (p.kind === "service") {
      expect(p.workspace).toBe(WS);
      expect(p.projects).toEqual([PRJ]);
      expect(p.scopes).toEqual(["queries:run"]);
    }
  });

  dbTest("an unknown digest is anonymous", async () => {
    expect((await principal("d_nope", "service")).kind).toBe("anonymous");
  });

  dbTest("a revoked key is anonymous, not a lesser key", async () => {
    expect((await principal("d_revoked", "service")).kind).toBe("anonymous");
  });

  dbTest("an expired key works before its expiry and not after", async () => {
    // The same row, two instants. v1 had no expiry at all, so rotation
    // overwrote a key in place and broke every deployed client instantly.
    expect((await principal("d_expired", "service", t0)).kind).toBe("service");
    expect((await principal("d_expired", "service", later)).kind).toBe("anonymous");
  });

  dbTest("a service key on an unclaimed project is unusable", async () => {
    // No workspace to be bound to. An unbound key is not a lesser key.
    expect((await principal("d_unclaimed", "service")).kind).toBe("anonymous");
  });

  dbTest("a share digest resolves to the dashboard and the projects its tiles read", async () => {
    const p = await principal("d_share", "share");
    expect(p.kind).toBe("share");
    if (p.kind === "share") {
      expect(p.dashboard).toBe(DASH);
      // Deduplicated: two tiles, one project.
      expect(p.projects).toEqual([PRJ]);
      expect(p.scopes).toEqual(["dashboards:read", "queries:run"]);
    }
  });

  dbTest("an expired share link is anonymous", async () => {
    await pool!.query(`UPDATE dashboards SET share_expires_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [DASH]);
    expect((await principal("d_share", "share")).kind).toBe("anonymous");
    await pool!.query(`UPDATE dashboards SET share_expires_at = '2026-12-01T00:00:00Z' WHERE id = $1`, [DASH]);
  });

  dbTest("the claimed kind cannot promote a key beyond what its row says", async () => {
    // The prefix is a routing hint, never authority. An ingest key presented
    // as `sk_` still resolves to an ingest principal with events:write only.
    const p = await principal("d_ingest", "service");
    expect(p.kind).toBe("ingest");
  });
});

describe("placing a resource in the tenancy tree", () => {
  const place = (r: Resource) => resolver!.placementOf(r);

  dbTest("a project places at its workspace and itself", async () => {
    expect(await place({ type: "project", id: PRJ })).toEqual({ workspace: WS, project: PRJ });
  });

  dbTest("an unclaimed project places nowhere", async () => {
    // It belongs to no workspace, so no membership reaches it. Adoption goes
    // through a claim grant, not through authorization.
    expect(await place({ type: "project", id: UNCLAIMED })).toBeNull();
  });

  dbTest("a dashboard places at its workspace, because it may span projects", async () => {
    expect(await place({ type: "dashboard", id: DASH })).toEqual({ workspace: WS, project: null });
  });

  dbTest("a monitor places at its project's workspace", async () => {
    expect(await place({ type: "monitor", id: MON })).toEqual({ workspace: WS, project: PRJ });
  });

  dbTest("a credential places at its project's workspace", async () => {
    expect(await place({ type: "credential", id: "44444444-0000-0000-0000-000000000001" })).toEqual({
      workspace: WS,
      project: PRJ,
    });
  });

  dbTest("a workspace places at itself", async () => {
    expect(await place({ type: "workspace", id: WS })).toEqual({ workspace: WS, project: null });
  });

  dbTest("every resource type answers null for an id that does not exist", async () => {
    const missing = "77777777-7777-7777-7777-777777777777";
    for (const type of ["workspace", "project", "dashboard", "monitor", "credential"] as const) {
      expect(await place({ type, id: missing } as Resource)).toBeNull();
    }
  });
});

describe("resolving a role", () => {
  dbTest("a member's role comes back", async () => {
    expect(await resolver!.roleOf(alice, WS)).toBe("admin");
  });

  dbTest("a non-member is null, not a default role", async () => {
    expect(await resolver!.roleOf(nobody, WS)).toBeNull();
  });

  dbTest("membership does not leak across workspaces", async () => {
    // The bug this would be: joining on account alone. Alice is an admin of
    // Acme and nothing at all of Other.
    expect(await resolver!.roleOf(alice, OTHER_WS)).toBeNull();
  });

  dbTest("an unrecognised role in the column is not authority", async () => {
    // A typo, or a role from a future version. It must not be read as
    // permission, and it must not crash the request either.
    await pool!.query(`UPDATE workspace_members SET role = 'superuser' WHERE workspace_id=$1 AND account_id=$2`, [
      WS,
      alice,
    ]);
    expect(await resolver!.roleOf(alice, WS)).toBeNull();
    await pool!.query(`UPDATE workspace_members SET role = 'admin' WHERE workspace_id=$1 AND account_id=$2`, [
      WS,
      alice,
    ]);
  });
});
