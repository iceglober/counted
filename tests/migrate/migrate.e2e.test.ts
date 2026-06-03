import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { startCaptureServer, type CaptureServer } from "../conformance/capture-server";

// E2E for @counted/migrate against a REAL self-hosted Aptabase events store.
//
// Aptabase keeps events in ClickHouse (not Postgres), with props split into
// string_props / numeric_props JSON columns — see aptabase/etc/clickhouse. This
// test stands up the same clickhouse-server image with that exact schema, seeds
// Aptabase-shaped rows for two apps, runs the actual CLI (--source-clickhouse,
// scoped by --app-id) against an ephemeral capture server, and asserts the
// converted Counted payloads. Also covers the CSV-export fallback.

const ROOT = join(import.meta.dir, "..", "..");
const CLI = join(ROOT, "packages", "migrate", "src", "cli.ts");
const CONTAINER = "counted-migrate-e2e-ch";
const CH_IMAGE = "clickhouse/clickhouse-server:23.8.4.69-alpine";
const APP = "app-counted";
const hasDocker = Bun.which("docker") !== null;

// Real schema: aptabase/etc/clickhouse/0001-events.sql + 0004 (device_model).
const CREATE_EVENTS = `
CREATE TABLE IF NOT EXISTS events (
  app_id String,
  timestamp DateTime,
  event_name String,
  user_id String,
  session_id String,
  os_name LowCardinality(String),
  os_version String,
  locale LowCardinality(String),
  app_version String,
  app_build_number String,
  engine_name LowCardinality(String),
  engine_version String,
  sdk_version String,
  country_code LowCardinality(String),
  region_name LowCardinality(String),
  city String,
  string_props String,
  numeric_props String,
  device_model String,
  ttl DateTime
) ENGINE = MergeTree() PARTITION BY toYYYYMM(timestamp) ORDER BY (app_id, timestamp, event_name) TTL ttl`;

type Row = {
  app_id: string;
  timestamp: string;
  event_name: string;
  session_id: string;
  os_name: string;
  os_version: string;
  locale: string;
  app_version: string;
  sdk_version: string;
  device_model: string;
  string_props: string;
  numeric_props: string;
};

function row(p: Partial<Row> & Pick<Row, "app_id" | "timestamp" | "event_name" | "session_id">): Row {
  return {
    os_name: "iOS", os_version: "17.2", locale: "en-US", app_version: "1.0.0",
    sdk_version: "aptabase-swift", device_model: "", string_props: "{}", numeric_props: "{}",
    ...p,
  };
}

// 5 events for our app + 2 decoy events for another app (must NOT be migrated).
const SEED: Row[] = [
  row({ app_id: APP, timestamp: "2026-01-01 10:00:00", event_name: "app_started", session_id: "s1", string_props: `{"screen":"home"}` }),
  row({ app_id: APP, timestamp: "2026-01-02 11:00:00", event_name: "purchase", session_id: "s1", device_model: "iPhone15,2", string_props: `{"plan":"pro"}`, numeric_props: `{"amount":12}` }),
  row({ app_id: APP, timestamp: "2026-01-03 12:00:00", event_name: "app_started", session_id: "s2", os_name: "Android", os_version: "14", locale: "de-DE", app_version: "1.1.0", sdk_version: "aptabase-kotlin" }),
  row({ app_id: APP, timestamp: "2026-01-04 13:00:00", event_name: "level_complete", session_id: "s2", os_name: "Android", sdk_version: "aptabase-kotlin", numeric_props: `{"level":3}` }),
  row({ app_id: APP, timestamp: "2026-01-05 14:00:00", event_name: "purchase", session_id: "s3", os_name: "macOS", sdk_version: "aptabase-web", string_props: `{"plan":"growth"}`, numeric_props: `{"amount":29}` }),
  row({ app_id: "app-other", timestamp: "2026-01-02 09:00:00", event_name: "noise", session_id: "x1" }),
  row({ app_id: "app-other", timestamp: "2026-01-03 09:00:00", event_name: "noise", session_id: "x2" }),
];

async function sh(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

let server: CaptureServer;
let chUrl = ""; // includes default user, no password
let sourceArg = "";

async function chExec(sql: string): Promise<Response> {
  return fetch(chUrl, { method: "POST", headers: { "Content-Type": "text/plain" }, body: sql });
}

describe.skipIf(!hasDocker)("@counted/migrate e2e (real Aptabase ClickHouse + CSV)", () => {
  beforeAll(async () => {
    server = await startCaptureServer();

    await sh(["docker", "rm", "-f", CONTAINER]);
    const run = await sh([
      "docker", "run", "-d", "--name", CONTAINER,
      "--ulimit", "nofile=262144:262144",
      "-P", CH_IMAGE,
    ]);
    if (run.code !== 0) throw new Error(`docker run failed: ${run.stderr}`);

    const portOut = await sh(["docker", "port", CONTAINER, "8123/tcp"]);
    const hostPort = portOut.stdout.trim().split("\n")[0]?.split(":").pop();
    if (!hostPort) throw new Error(`could not read mapped port: ${portOut.stdout}`);
    chUrl = `http://127.0.0.1:${hostPort}/`;
    sourceArg = `http://default@127.0.0.1:${hostPort}`;

    // Wait for the HTTP interface, then create + seed.
    const deadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await chExec("SELECT 1");
        if (res.ok) { ready = true; break; }
      } catch {
        /* not up yet */
      }
      await Bun.sleep(1500);
    }
    if (!ready) throw new Error("ClickHouse never became ready");

    const created = await chExec(CREATE_EVENTS);
    if (!created.ok) throw new Error(`create failed: ${await created.text()}`);

    const ndjson = SEED.map((r) => JSON.stringify({ ...r, user_id: "", app_build_number: "", engine_name: "", engine_version: "", country_code: "", region_name: "", city: "", ttl: "2099-01-01 00:00:00" })).join("\n");
    const inserted = await chExec(`INSERT INTO events FORMAT JSONEachRow\n${ndjson}`);
    if (!inserted.ok) throw new Error(`insert failed: ${await inserted.text()}`);
  }, 180_000);

  afterAll(async () => {
    await server?.stop();
    await sh(["docker", "rm", "-f", CONTAINER]);
  });

  test("imports only the target app, recombining split props correctly", async () => {
    server.reset();
    const res = await sh([
      "bun", CLI,
      "--source-clickhouse", sourceArg,
      "--app-id", APP,
      "--target-key", "ck_migrate_e2e",
      "--target-host", server.url,
      "--batch-size", "2",
    ]);
    expect(res.code).toBe(0);

    const events = server.events();
    expect(events.length).toBe(5); // app-other's 2 events excluded

    expect(server.requests().some((r) => r.wasArray && r.count > 1)).toBe(true);
    expect(events.map((e) => e.eventName).sort()).toEqual(
      ["app_started", "app_started", "level_complete", "purchase", "purchase"],
    );

    // Split string_props + numeric_props recombined into one props object.
    const pro = events.find((e) => (e.props as any)?.plan === "pro");
    expect(pro).toBeDefined();
    expect(pro!.eventName).toBe("purchase");
    expect(pro!.sessionId).toBe("s1");
    expect(pro!.props).toMatchObject({ plan: "pro", amount: 12 });
    expect(pro!.systemProps).toMatchObject({
      osName: "iOS",
      sdkVersion: "aptabase-swift",
      deviceModel: "iPhone15,2",
      isDebug: false,
    });
  }, 90_000);

  test("--since filters by timestamp", async () => {
    server.reset();
    const res = await sh([
      "bun", CLI,
      "--source-clickhouse", sourceArg,
      "--app-id", APP,
      "--target-key", "ck_migrate_e2e",
      "--target-host", server.url,
      "--since", "2026-01-04 00:00:00",
    ]);
    expect(res.code).toBe(0);
    expect(server.events().map((e) => e.eventName).sort()).toEqual(["level_complete", "purchase"]);
  }, 90_000);

  test("--dry-run sends nothing", async () => {
    server.reset();
    const res = await sh([
      "bun", CLI,
      "--source-clickhouse", sourceArg,
      "--app-id", APP,
      "--target-key", "ck_migrate_e2e",
      "--target-host", server.url,
      "--dry-run",
    ]);
    expect(res.code).toBe(0);
    expect(server.events().length).toBe(0);
  }, 90_000);

  test("imports from a CSV export (string_props/numeric_props columns)", async () => {
    server.reset();
    const dir = await mkdtemp(join(tmpdir(), "counted-migrate-"));
    const csvPath = join(dir, "export.csv");
    const header = "timestamp,session_id,event_name,os_name,sdk_version,device_model,string_props,numeric_props";
    const lines = SEED.filter((r) => r.app_id === APP).map(
      (r) => `${r.timestamp},${r.session_id},${r.event_name},${r.os_name},${r.sdk_version},"${r.device_model}","${r.string_props.replace(/"/g, '""')}","${r.numeric_props.replace(/"/g, '""')}"`,
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
      expect(events.length).toBe(5);
      const pro = events.find((e) => (e.props as any)?.plan === "pro");
      expect(pro!.props).toMatchObject({ plan: "pro", amount: 12 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
