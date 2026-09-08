import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { applyMigrations, applySchema, projectCreatedAt } from "@counted/adapter-postgres";
import { analyticsMigrations, LiticsEventSink, LiticsAnalyticsEngine, orgUpsert, packNow, segmentsTable, stagingTable, type WritePool } from "@counted/analytics-adapter-litics";
import { dedupKey, type AdmittedEvent, type RawEvent } from "@counted/ingestion-domain";
import { GroupCommit, DEFAULT_GROUP_COMMIT_POLICY } from "@counted/ingestion-app";
import { Duration, err, Instant, ProjectId, VisitId, WorkspaceId } from "@counted/kernel";
import { derivedIngestQuota } from "./quota";
import { silentLogger } from "../logging";
import { Entitlement } from "@counted/tenancy-domain";
import { fixedClock } from "@counted/kernel/ports";

// An isolated database lets packing and a restarted pool exercise the real
// production schema without touching another test's or a developer's events.
const connectionString = process.env["COUNTED_TEST_DATABASE_URL"];
const describeLive = connectionString ? describe : describe.skip;
const database = `counted_dedup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const project = ProjectId("dedup_project");
const otherProject = ProjectId("dedup_other_project");
const workspace = WorkspaceId("dedup_workspace");
const now = Instant.fromEpochMillis(Date.now());
let pool: Pool;
const databaseUrl = () => { const url = new URL(connectionString!); url.pathname = `/${database}`; return url.toString(); };
const event = (key: string | null, occurredAt = now): AdmittedEvent => ({
  name: "dedup_check", visit: VisitId("1770000000.abcd1234"), person: null, occurredAt, receivedAt: now,
  dedupKey: key === null ? null : dedupKey(key, occurredAt), properties: {},
  system: {country:null,os_name:"other",os_name_raw:null,os_version:null,locale:null,app_version:null,device_model:null,sdk_version:null},
});
const stored = async (target = project) => {
  const result = await pool.query<{n:string}>(`SELECT ((SELECT count(*) FROM ${stagingTable()} WHERE tenant_id=$1) + COALESCE((SELECT sum(n) FROM ${segmentsTable()} WHERE tenant_id=$1),0))::text AS n`, [target]);
  return Number(result.rows[0]!.n);
};

const receipt = async (sink: LiticsEventSink, target: ProjectId, events: readonly AdmittedEvent[]) => {
  const outcome = await sink.writeBatch(target, events);
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.error));
  return outcome.value;
};

describeLive("durable ingestion idempotency over PostgreSQL", () => {
  beforeAll(async () => {
    const admin = new Pool({connectionString, max:1});
    try { await admin.query(`CREATE DATABASE ${database}`); } finally { await admin.end(); }
    pool = new Pool({connectionString:databaseUrl(), max:12});
    await applySchema(pool);
    await applyMigrations(pool, analyticsMigrations());
    await pool.query("INSERT INTO workspaces (id,name,plan,payment_state) VALUES ($1,'Dedup fixture','free','none')", [workspace]);
    for (const id of [project, otherProject]) {
      await pool.query("INSERT INTO projects (id,workspace_id,name,claimed_at) VALUES ($1,$2,'Dedup fixture',now())", [id,workspace]);
      const org = orgUpsert(id, null); await pool.query(org.sql, org.parameters);
    }
  }, 30_000);
  afterAll(async () => {
    if (pool) await pool.end();
    const admin = new Pool({connectionString,max:1});
    try { await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); } finally { await admin.end(); }
  });

  test("retries after a process/pool restart and after packing never count twice", async () => {
    const original = event("restart-safe");
    expect(await receipt(new LiticsEventSink({pool}),project,[original])).toEqual({written:1,writtenIndices:[0],deduplicated:0});
    await pool.end(); pool = new Pool({connectionString:databaseUrl(),max:12});
    expect(await receipt(new LiticsEventSink({pool}),project,[original])).toEqual({written:0,writtenIndices:[],deduplicated:1});
    await packNow(pool);
    const packed = await pool.query(`SELECT 1 FROM ${segmentsTable()} WHERE tenant_id=$1`, [project]);
    expect(packed.rowCount).toBeGreaterThan(0);
    expect(await receipt(new LiticsEventSink({pool}),project,[original])).toEqual({written:0,writtenIndices:[],deduplicated:1});
    expect(await stored()).toBe(1);
  });

  test("concurrent overlapping retries reserve once across separate sinks, regardless of key order", async () => {
    const before = await stored();
    const outcomes = await Promise.all(Array.from({length:8}, (_,i) => {
      const common = [event("race-a"),event("race-b")];
      if (i % 2 === 0) common.reverse();
      return receipt(new LiticsEventSink({pool}),project,[...common,event(`race-unique-${i}`)]);
    }));
    expect(outcomes.reduce((n,row) => n+row.written,0)).toBe(10);
    expect(outcomes.reduce((n,row) => n+row.deduplicated,0)).toBe(14);
    for (const row of outcomes) {
      expect(row.writtenIndices).toContain(2);
      expect(row.written + row.deduplicated).toBe(3);
    }
    expect(await stored()-before).toBe(10);
  });

  test("the key includes occurredAt and project; unkeyed events retain at-least-once semantics", async () => {
    const later = Instant.fromEpochMillis(Instant.toEpochMillis(now)+1);
    const input = [event("scope"),event("scope"),event("scope",later),event(null),event(null)];
    expect(await receipt(new LiticsEventSink({pool}),project,input)).toEqual({written:4,writtenIndices:[0,2,3,4],deduplicated:1});
    expect(await receipt(new LiticsEventSink({pool}),otherProject,[event("scope")])).toEqual({written:1,writtenIndices:[0],deduplicated:0});
    expect(await receipt(new LiticsEventSink({pool}),project,input)).toEqual({written:2,writtenIndices:[3,4],deduplicated:3});
  });

  test("an analytics write failure rolls its receipt back so a retry can store the event", async () => {
    const broken: WritePool = {connect: async () => {
      const client = await pool.connect();
      return {
        query: async (sql, values) => {
          if (sql.startsWith("INSERT") && !sql.includes("public.ingest_receipts")) return client.query("SELECT 1/0");
          return client.query(sql, values);
        },
        release: (destroy) => client.release(destroy),
      };
    }};
    const before = await stored();
    expect((await new LiticsEventSink({pool:broken}).writeBatch(project,[event("rolled-back")])).ok).toBe(false);
    expect(await receipt(new LiticsEventSink({pool}),project,[event("rolled-back")])).toEqual({written:1,writtenIndices:[0],deduplicated:0});
    expect(await stored()-before).toBe(1);
  });

  test("requests sharing a commit get their own accepted and deduplicated counts", async () => {
    const sink = new LiticsEventSink({pool});
    await receipt(sink,project,[event("already-stored")]);
    const recorded: number[] = [];
    const coalescer = new GroupCommit({sink,clock:fixedClock(now),quota:{
      check:async () => ({kind:"Allowed",remaining:null}), record:async (_workspace,n) => {recorded.push(n);},
    }});
    const raw = (key: string): RawEvent => ({name:"dedup_check",visitId:"1770000000.abcd1234",occurredAt:Instant.toISO(now),idempotencyKey:key});
    const submit = (keys: string[]) => coalescer.submit({project,workspace,receivedAt:now,events:keys.map(raw),country:null,bytes:null});
    const one = submit(["already-stored","group-new","group-new"]);
    const two = submit(["group-new","group-other"]);
    for (let i=0;i<8;i++) await Promise.resolve();
    await coalescer.drain();
    expect(await one).toMatchObject({kind:"Committed",accepted:1,deduplicated:2});
    expect(await two).toMatchObject({kind:"Committed",accepted:1,deduplicated:1});
    expect(recorded).toEqual([2]);
  });

  test("unclaimed allowance counts durable project events across failed writes, retries, packing and restart", async () => {
    const unclaimed = ProjectId("dedup_unclaimed");
    await pool.query("INSERT INTO projects (id,name,claim_digest,claim_expires_at) VALUES ($1,'Unclaimed fixture','fixture-digest',now()+interval '1 day')", [unclaimed]);
    // Deliberately no analytics_org row: provisional projects have no workspace.
    const probeAt = Instant.plus(now,Duration.seconds(10));
    const makeQuota = () => derivedIngestQuota({
      engine: new LiticsAnalyticsEngine({pool,clock:fixedClock(probeAt)}),
      projectWorkspace: async () => null,
      projectCreatedAt: (project) => projectCreatedAt(pool,project),
      workspaceEntitlement: async () => Entitlement.none(),
      logger: silentLogger, deadline: Duration.seconds(5), unclaimedAllowance: 3,
    });
    let quota = makeQuota();
    const send = async (key: string, fail = false) => {
      const coalescer = new GroupCommit({clock:fixedClock(probeAt),quota,policy:{...DEFAULT_GROUP_COMMIT_POLICY,maxEvents:1},
        sink: fail ? {writeBatch:async () => err({kind:"SinkUnavailable",detail:"fixture failure"})} : new LiticsEventSink({pool}),
      });
      const reply = coalescer.submit({project:unclaimed,workspace,receivedAt:probeAt,country:null,bytes:null,events:[{
        name:"provisional",visitId:"provisional-visit",occurredAt:Instant.toISO(now),idempotencyKey:key,
      }]});
      const outcome = await reply;
      await coalescer.drain();
      return outcome;
    };
    expect(await send("failed",true)).toMatchObject({kind:"Refused"});
    expect(await send("first")).toMatchObject({kind:"Committed",accepted:1,deduplicated:0});
    expect(await send("first")).toMatchObject({kind:"Committed",accepted:0,deduplicated:1});
    expect(await send("second")).toMatchObject({kind:"Committed",accepted:1});
    expect(await send("third")).toMatchObject({kind:"Committed",accepted:1});
    expect(await stored(unclaimed)).toBe(3);
    await packNow(pool);
    await pool.end(); pool = new Pool({connectionString:databaseUrl(),max:12});
    quota = makeQuota();
    expect(await quota.check(unclaimed,1,probeAt)).toEqual({kind:"PlanExceeded",limit:3,used:4});
    expect(await stored(unclaimed)).toBe(3);
    const deleted = await pool.query("DELETE FROM projects WHERE id=$1",[unclaimed]);
    expect(deleted.rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM ingest_receipts WHERE project_id=$1",[unclaimed])).rowCount).toBe(0);
  });

});
