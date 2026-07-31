/**
 * Persistence, against a real PostgreSQL.
 *
 * The cases that matter most are the rollback ones. v1 had two flows labelled
 * transactional that were not, and no test could have caught it because there
 * was no boundary to test.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { createDatabase, type LiveDatabase } from "./testing/database";
import {
  AccountId,
  CredentialDigest,
  CredentialId,
  CredentialPrefix,
  Dashboard,
  DashboardId,
  Duration,
  Instant,
  Project,
  ProjectId,
  Workspace,
  WorkspaceId,
  WorkspaceLimits,
} from "@counted/domain";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import { CONTROL_PLANE_STATEMENTS } from "./sql/control-plane";
import { PostgresUnitOfWork } from "./unit-of-work";

const DB = "counted_v2_persistence";

const t0 = Instant.fromEpochMillis(Date.parse("2026-02-01T00:00:00Z"));
const WS = WorkspaceId("22222222-2222-2222-2222-222222222222");
const PRJ = ProjectId("33333333-3333-3333-3333-333333333333");
const alice = AccountId("acc_alice");
const bob = AccountId("acc_bob");

let pool: Pool | null = null;
let live: LiveDatabase | null = null;
let uow: PostgresUnitOfWork | null = null;
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

const must = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
  return r.value;
};

const ingestCredential = (n: string) => ({
  id: CredentialId(`4444444${n}-4444-4444-4444-44444444444${n}`),
  kind: "ingest" as const,
  label: `key ${n}`,
  digest: CredentialDigest(`digest_${n}`),
  prefix: CredentialPrefix(`ck_${n}`),
});

beforeAll(async () => {
  try {
    live = await createDatabase(DB);
    pool = live.pool;
    for (const s of SCHEMA_STATEMENTS) await pool.query(s);
    for (const s of CONTROL_PLANE_STATEMENTS) await pool.query(s);
    uow = new PostgresUnitOfWork(pool);
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
  await pool!.query("TRUNCATE outbox, credentials, projects, workspace_members, dashboards, monitors, workspaces CASCADE");
};

describe("aggregates round-trip", () => {
  dbTest("a workspace keeps its members and roles", async () => {
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.UNLIMITED, t0));
    const admitted = must(opened.workspace.admit(bob, "admin", t0));

    await uow!.transact(async (r) => r.workspaces.save(admitted.workspace, admitted.events));
    const loaded = await uow!.transact(async (r) => r.workspaces.find(WS));

    expect(loaded).not.toBeNull();
    expect(loaded!.memberCount).toBe(2);
    expect(loaded!.roleOf(alice)).toBe("owner");
    expect(loaded!.roleOf(bob)).toBe("admin");
    // And the invariants still hold after a round trip through SQL.
    expect(loaded!.remove(alice, t0).ok).toBe(false);
  });

  dbTest("a project keeps its credentials, and only their digests are stored", async () => {
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.UNLIMITED, t0));
    await uow!.transact(async (r) => r.workspaces.save(opened.workspace, opened.events));

    const created = must(Project.create(PRJ, "Web", WS, ingestCredential("1"), t0));
    await uow!.transact(async (r) => r.projects.save(created.project, created.events));

    const loaded = await uow!.transact(async (r) => r.projects.find(PRJ));
    expect(loaded!.usableIngestCredentials(t0)).toHaveLength(1);
    expect(loaded!.workspace).toBe(WS);

    // No column anywhere holds a secret — only the hash.
    const columns = (
      await pool!.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'credentials'`)
    ).rows.map((r) => String(r.column_name));
    expect(columns).toContain("digest");
    expect(columns).not.toContain("secret");
  });

  dbTest("a credential resolves by digest — the ingest hot path", async () => {
    const found = await uow!.transact(async (r) => r.projects.findByCredentialDigest(CredentialDigest("digest_1")));
    expect(found?.id).toBe(PRJ);
  });

  dbTest("a revoked credential survives the round trip as revoked", async () => {
    const project = (await uow!.transact(async (r) => r.projects.find(PRJ)))!;
    const withSecond = must(project.issue(ingestCredential("2"), t0));
    const revoked = must(withSecond.project.revoke(CredentialId("44444441-4444-4444-4444-444444444441"), t0));

    await uow!.transact(async (r) => r.projects.save(revoked.project, revoked.events));
    const loaded = (await uow!.transact(async (r) => r.projects.find(PRJ)))!;

    expect(loaded.usableIngestCredentials(t0)).toHaveLength(1);
    expect(loaded.authenticate(CredentialDigest("digest_1"), t0).ok).toBe(false);
  });

  dbTest("a dashboard keeps its tiles and its share grant", async () => {
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.UNLIMITED, t0));
    await uow!.transact(async (r) => r.workspaces.save(opened.workspace, opened.events));

    const id = DashboardId("55555555-5555-5555-5555-555555555555");
    const created = must(Dashboard.create(id, WS, "Overview", t0));
    const shared = must(
      created.dashboard.grantShare({ digest: "share_x", expiresAt: Instant.plus(t0, Duration.days(30)) }, t0),
    );
    await uow!.transact(async (r) => r.dashboards.save(shared.dashboard, shared.events));

    const byShare = await uow!.transact(async (r) => r.dashboards.findByShareDigest("share_x"));
    expect(byShare?.id).toBe(id);
    expect(byShare!.allowsShareRead("share_x", t0)).toBe(true);
  });
});

describe("the transaction is real", () => {
  dbTest("a failure after a save leaves nothing behind", async () => {
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.UNLIMITED, t0));

    await expect(
      uow!.transact(async (r) => {
        await r.workspaces.save(opened.workspace, opened.events);
        // The aggregate is written and its events are queued. Now fail.
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");

    const found = await uow!.transact(async (r) => r.workspaces.find(WS));
    expect(found).toBeNull();
    const pending = await uow!.transact(async (r) => r.outbox.pendingCount());
    expect(pending).toBe(0);
  });

  dbTest("two aggregates commit together or not at all", async () => {
    // Creating a project touches the workspace (which registers it against the
    // cap) and the project itself. Both, or neither.
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.of(1, null), t0));
    const registered = must(opened.workspace.provisionProject(PRJ, "Web", t0));
    const created = must(Project.create(PRJ, "Web", WS, ingestCredential("1"), t0));

    await expect(
      uow!.transact(async (r) => {
        await r.workspaces.save(registered.workspace, registered.events);
        await r.projects.save(created.project, created.events);
        throw new Error("late failure");
      }),
    ).rejects.toThrow("late failure");

    expect(await uow!.transact(async (r) => r.workspaces.find(WS))).toBeNull();
    expect(await uow!.transact(async (r) => r.projects.find(PRJ))).toBeNull();
  });

  dbTest("a successful two-aggregate commit persists both", async () => {
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.of(1, null), t0));
    const registered = must(opened.workspace.provisionProject(PRJ, "Web", t0));
    const created = must(Project.create(PRJ, "Web", WS, ingestCredential("1"), t0));

    await uow!.transact(async (r) => {
      await r.workspaces.save(registered.workspace, registered.events);
      await r.projects.save(created.project, created.events);
    });

    const workspace = await uow!.transact(async (r) => r.workspaces.find(WS));
    expect(workspace!.activeProjects()).toHaveLength(1);
    expect(await uow!.transact(async (r) => r.projects.find(PRJ))).not.toBeNull();
  });
});

describe("the outbox rides the same transaction", () => {
  dbTest("events are queued alongside the aggregate that produced them", async () => {
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.UNLIMITED, t0));
    await uow!.transact(async (r) => r.workspaces.save(opened.workspace, opened.events));

    const pending = await uow!.transact(async (r) => r.outbox.claim(10));
    expect(pending.map((e) => e.type)).toContain("WorkspaceOpened");
  });

  dbTest("dispatching marks them, and they are not claimed twice", async () => {
    const claimed = await uow!.transact(async (r) => {
      const events = await r.outbox.claim(10);
      await r.outbox.markDispatched(events.map((e) => e.id), t0);
      return events;
    });
    expect(claimed.length).toBeGreaterThan(0);

    const remaining = await uow!.transact(async (r) => r.outbox.pendingCount());
    expect(remaining).toBe(0);
  });

  dbTest("a rolled-back command queues nothing", async () => {
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.UNLIMITED, t0));
    await uow!
      .transact(async (r) => {
        await r.workspaces.save(opened.workspace, opened.events);
        throw new Error("nope");
      })
      .catch(() => undefined);

    expect(await uow!.transact(async (r) => r.outbox.pendingCount())).toBe(0);
  });
});

describe("one default dashboard per workspace", () => {
  dbTest("the database enforces it, not just the application", async () => {
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.UNLIMITED, t0));
    await uow!.transact(async (r) => r.workspaces.save(opened.workspace, opened.events));

    const first = must(Dashboard.create(DashboardId("66666666-6666-6666-6666-666666666666"), WS, "A", t0, true));
    await uow!.transact(async (r) => r.dashboards.save(first.dashboard, first.events));

    const second = must(Dashboard.create(DashboardId("77777777-7777-7777-7777-777777777777"), WS, "B", t0, true));
    await expect(uow!.transact(async (r) => r.dashboards.save(second.dashboard, second.events))).rejects.toThrow();
  });
});

describe("the list and delete methods the ports declared", () => {
  /**
   * These were declared in `packages/ports` and never implemented, and nothing
   * noticed because nothing called them until the management endpoints did.
   * Same shape of gap as a `SecretGenerator` whose adapter was never typed
   * against its port: a promise in an interface with no implementation behind
   * it.
   */
  dbTest("projects list for their workspace, with their credentials", async () => {
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.UNLIMITED, t0));
    await uow!.transact(async (r) => r.workspaces.save(opened.workspace, opened.events));

    const first = must(Project.create(PRJ, "Web", WS, ingestCredential("1"), t0));
    const second = must(
      Project.create(ProjectId("33333333-3333-3333-3333-333333333334"), "Docs", WS, ingestCredential("2"), t0),
    );
    await uow!.transact(async (r) => {
      await r.projects.save(first.project, first.events);
      await r.projects.save(second.project, second.events);
    });

    const listed = await uow!.transact(async (r) => r.projects.listForWorkspace(WS));
    expect(listed).toHaveLength(2);
    // Credentials come with them, or the management list would show none.
    expect(listed.every((p) => p.snapshot().credentials.length === 1)).toBe(true);
  });

  dbTest("a project in another workspace is not listed", async () => {
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.UNLIMITED, t0));
    await uow!.transact(async (r) => r.workspaces.save(opened.workspace, opened.events));
    const listed = await uow!.transact(async (r) =>
      r.projects.listForWorkspace(WorkspaceId("22222222-2222-2222-2222-222222222299")),
    );
    expect(listed).toHaveLength(0);
  });

  dbTest("dashboards list default-first, and delete removes them", async () => {
    await clean();
    const opened = must(Workspace.open(WS, "Acme", alice, WorkspaceLimits.UNLIMITED, t0));
    await uow!.transact(async (r) => r.workspaces.save(opened.workspace, opened.events));

    const plain = must(Dashboard.create(DashboardId("55555555-5555-5555-5555-555555555551"), WS, "Zebra", t0));
    const preferred = must(
      Dashboard.create(DashboardId("55555555-5555-5555-5555-555555555552"), WS, "Aardvark", t0, true),
    );
    await uow!.transact(async (r) => {
      await r.dashboards.save(plain.dashboard, plain.events);
      await r.dashboards.save(preferred.dashboard, preferred.events);
    });

    const listed = await uow!.transact(async (r) => r.dashboards.listForWorkspace(WS));
    // Default first even though its name sorts later: a list a human reads
    // should open on the one they meant.
    expect(listed.map((d) => d.snapshot().name)).toEqual(["Aardvark", "Zebra"]);

    await uow!.transact(async (r) => r.dashboards.delete(DashboardId("55555555-5555-5555-5555-555555555551")));
    const after = await uow!.transact(async (r) => r.dashboards.listForWorkspace(WS));
    expect(after).toHaveLength(1);
  });
});
