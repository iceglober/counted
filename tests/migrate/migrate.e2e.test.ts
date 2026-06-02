import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import pg from "pg";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { startCaptureServer, type CaptureServer } from "../conformance/capture-server";

// E2E for @counted/migrate against a REAL Aptabase-shaped Postgres in Docker.
//
// The migration tool's job: read `SELECT * FROM events` from an Aptabase
// Postgres (or a CSV) and POST Counted-shaped events to /api/v0/event. We run
// the actual CLI end to end — Docker Postgres source → ephemeral capture server
// sink — and assert the converted wire payloads.
//
// Scope note: the seeded `events` table matches the schema the CLI reads (the
// documented --source-db contract). It does NOT clone a live Aptabase instance,
// so if Aptabase's real `events` schema diverges (e.g. split string/numeric prop
// columns), the CLI's mapping would still need validation against a real dump —
// tracked in the internal HANDOFF. The Counted-side App-Key ingestion compat is
// the app's concern and covered separately.

const ROOT = join(import.meta.dir, "..", "..");
const CLI = join(ROOT, "packages", "migrate", "src", "cli.ts");
const CONTAINER = "counted-migrate-e2e-pg";
const hasDocker = Bun.which("docker") !== null;

type Seed = {
  timestamp: string;
  session_id: string;
  event_name: string;
  os_name: string;
  os_version: string;
  locale: string;
  app_version: string;
  sdk_version: string;
  props: Record<string, unknown>;
};

const SEED: Seed[] = [
  { timestamp: "2026-01-01T10:00:00.000Z", session_id: "s1", event_name: "app_started", os_name: "iOS", os_version: "17.2", locale: "en-US", app_version: "1.0.0", sdk_version: "aptabase-swift", props: { screen: "home" } },
  { timestamp: "2026-01-02T11:00:00.000Z", session_id: "s1", event_name: "purchase", os_name: "iOS", os_version: "17.2", locale: "en-US", app_version: "1.0.0", sdk_version: "aptabase-swift", props: { plan: "pro", amount: 12 } },
  { timestamp: "2026-01-03T12:00:00.000Z", session_id: "s2", event_name: "app_started", os_name: "Android", os_version: "14", locale: "de-DE", app_version: "1.1.0", sdk_version: "aptabase-kotlin", props: {} },
  { timestamp: "2026-01-04T13:00:00.000Z", session_id: "s2", event_name: "level_complete", os_name: "Android", os_version: "14", locale: "de-DE", app_version: "1.1.0", sdk_version: "aptabase-kotlin", props: { level: 3 } },
  { timestamp: "2026-01-05T14:00:00.000Z", session_id: "s3", event_name: "purchase", os_name: "macOS", os_version: "15.0", locale: "fr-FR", app_version: "2.0.0", sdk_version: "aptabase-web", props: { plan: "growth", amount: 29 } },
];

async function sh(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

let server: CaptureServer;
let connectionString = "";

describe.skipIf(!hasDocker)("@counted/migrate e2e (Docker Postgres + CSV)", () => {
  beforeAll(async () => {
    server = await startCaptureServer();

    // Start an Aptabase-shaped Postgres on a Docker-assigned port.
    await sh(["docker", "rm", "-f", CONTAINER]);
    const run = await sh([
      "docker", "run", "-d", "--name", CONTAINER,
      "-e", "POSTGRES_PASSWORD=postgres",
      "-e", "POSTGRES_DB=aptabase",
      "-P", "postgres:17",
    ]);
    if (run.code !== 0) throw new Error(`docker run failed: ${run.stderr}`);

    const portOut = await sh(["docker", "port", CONTAINER, "5432/tcp"]);
    const hostPort = portOut.stdout.trim().split("\n")[0]?.split(":").pop();
    if (!hostPort) throw new Error(`could not read mapped port: ${portOut.stdout}`);
    connectionString = `postgres://postgres:postgres@127.0.0.1:${hostPort}/aptabase`;

    // Wait for readiness, then create + seed the events table.
    const deadline = Date.now() + 60_000;
    let client: pg.Client | null = null;
    while (Date.now() < deadline) {
      try {
        const c = new pg.Client({ connectionString });
        await c.connect();
        client = c;
        break;
      } catch {
        await Bun.sleep(1000);
      }
    }
    if (!client) throw new Error("Postgres never became ready");

    await client.query(`
      CREATE TABLE events (
        timestamp   timestamptz NOT NULL,
        session_id  text NOT NULL,
        event_name  text NOT NULL,
        os_name     text,
        os_version  text,
        locale      text,
        app_version text,
        sdk_version text,
        props       jsonb
      )
    `);
    for (const r of SEED) {
      await client.query(
        `INSERT INTO events (timestamp, session_id, event_name, os_name, os_version, locale, app_version, sdk_version, props)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [r.timestamp, r.session_id, r.event_name, r.os_name, r.os_version, r.locale, r.app_version, r.sdk_version, JSON.stringify(r.props)],
      );
    }
    await client.end();
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
    await sh(["docker", "rm", "-f", CONTAINER]);
  });

  test("imports every event from an Aptabase Postgres with correct mapping", async () => {
    server.reset();
    const res = await sh([
      "bun", CLI,
      "--source-db", connectionString,
      "--target-key", "ck_migrate_e2e",
      "--target-host", server.url,
      "--batch-size", "2",
    ]);
    expect(res.code).toBe(0);

    const events = server.events();
    expect(events.length).toBe(SEED.length);

    // Batching: at least one request carried a multi-event JSON array.
    expect(server.requests().some((r) => r.wasArray && r.count > 1)).toBe(true);

    // Event names round-trip (order-independent across concurrent batches).
    expect(events.map((e) => e.eventName).sort()).toEqual(SEED.map((s) => s.event_name).sort());

    // Field-level mapping on a representative event.
    const purchase = events.find((e) => e.eventName === "purchase" && (e.props as any)?.plan === "pro");
    expect(purchase).toBeDefined();
    expect(purchase!.sessionId).toBe("s1");
    expect(purchase!.props).toMatchObject({ plan: "pro", amount: 12 });
    expect(purchase!.systemProps).toMatchObject({
      osName: "iOS",
      osVersion: "17.2",
      locale: "en-US",
      appVersion: "1.0.0",
      sdkVersion: "aptabase-swift",
      deviceModel: null,
      isDebug: false,
    });
  }, 60_000);

  test("--since filters by timestamp", async () => {
    server.reset();
    const res = await sh([
      "bun", CLI,
      "--source-db", connectionString,
      "--target-key", "ck_migrate_e2e",
      "--target-host", server.url,
      "--since", "2026-01-04T00:00:00.000Z",
    ]);
    expect(res.code).toBe(0);

    const names = server.events().map((e) => e.eventName).sort();
    expect(names).toEqual(["level_complete", "purchase"]); // only the last two rows
  }, 60_000);

  test("--dry-run sends nothing", async () => {
    server.reset();
    const res = await sh([
      "bun", CLI,
      "--source-db", connectionString,
      "--target-key", "ck_migrate_e2e",
      "--target-host", server.url,
      "--dry-run",
    ]);
    expect(res.code).toBe(0);
    expect(server.events().length).toBe(0);
  }, 60_000);

  test("imports from a CSV source", async () => {
    server.reset();
    const dir = await mkdtemp(join(tmpdir(), "counted-migrate-"));
    const csvPath = join(dir, "export.csv");
    const header = "timestamp,session_id,event_name,os_name,os_version,locale,app_version,sdk_version";
    const lines = SEED.map(
      (r) => `${r.timestamp},${r.session_id},${r.event_name},${r.os_name},${r.os_version},${r.locale},${r.app_version},${r.sdk_version}`,
    );
    await writeFile(csvPath, [header, ...lines].join("\n"), "utf-8");

    try {
      const res = await sh([
        "bun", CLI,
        "--source-csv", csvPath,
        "--target-key", "ck_migrate_e2e",
        "--target-host", server.url,
        "--batch-size", "2",
      ]);
      expect(res.code).toBe(0);

      const events = server.events();
      expect(events.length).toBe(SEED.length);
      expect(events.map((e) => e.eventName).sort()).toEqual(SEED.map((s) => s.event_name).sort());
      const android = events.find((e) => (e.systemProps as any)?.osName === "Android");
      expect(android).toBeDefined();
      expect(android!.systemProps).toMatchObject({ sdkVersion: "aptabase-kotlin" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
