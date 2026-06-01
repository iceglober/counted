#!/usr/bin/env bun
/**
 * Continuous synthetic traffic generator.
 *
 * Sends realistic session journeys through the REAL ingestion API
 * (POST /api/v0/event) — not direct DB inserts — so it exercises validation,
 * the projects-key lookup, the event buffer, and TimescaleDB the same way a
 * real SDK does. Keeps dashboards, funnels, retention, and alerts running on
 * live, evolving data while Counted has no real users.
 *
 * Env:
 *   TRAFFIC_HOST          target base URL (default http://localhost:3000)
 *   TRAFFIC_KEYS          comma-separated client keys (ck_...). If unset, reads
 *                         projects.client_key from DATABASE_URL (local convenience)
 *   TRAFFIC_RATE          events per minute (default 120)
 *   TRAFFIC_BACKFILL_DAYS backfill this many days of history on start (default 0)
 *   TRAFFIC_DURATION_SEC  stop after N seconds (default 0 = run forever)
 *
 * Examples:
 *   bun scripts/generate-traffic.ts                       # local, reads seeded keys
 *   TRAFFIC_BACKFILL_DAYS=30 bun scripts/generate-traffic.ts
 *   TRAFFIC_HOST=https://app.counted.dev TRAFFIC_KEYS=ck_a,ck_b bun scripts/generate-traffic.ts
 */
export {};

const HOST = (process.env.TRAFFIC_HOST ?? "http://localhost:3000").replace(/\/$/, "");
const RATE = Number(process.env.TRAFFIC_RATE ?? 120);
const BACKFILL_DAYS = Number(process.env.TRAFFIC_BACKFILL_DAYS ?? 0);
const DURATION_SEC = Number(process.env.TRAFFIC_DURATION_SEC ?? 0);
const TICK_MS = 5_000;
const MAX_BATCH = 50;
const DAY_MS = 86_400_000;

// ─── Reference data (mirrors seed.ts; kept self-contained on purpose) ──────────
const PAGES = ["/", "/pricing", "/features", "/docs", "/docs/quickstart", "/blog", "/about", "/changelog"];
const BUTTONS = ["signup-cta", "pricing-toggle", "docs-link", "github-star", "theme-toggle", "copy-snippet"];
const FORMS = ["contact", "feedback", "newsletter", "demo-request"];
const CHANNELS = ["twitter", "linkedin", "email", "copy-link", "reddit"];
const PLANS = ["free", "free", "free", "free", "pro", "pro", "enterprise"];
const PRICES = [9, 12, 29, 29, 79, 199];
const LOCALES = ["en-US", "en-US", "en-US", "en-GB", "de-DE", "fr-FR", "ja-JP", "pt-BR", "es-ES"];
const VERSIONS = ["2.4.0", "2.4.0", "2.3.2", "2.3.1", "2.2.0"];
const OSES = [
  { name: "macOS", ver: "15.5", weight: 38, models: [null] },
  { name: "Windows", ver: "11", weight: 24, models: [null] },
  { name: "Linux", ver: "6.8", weight: 13, models: [null] },
  { name: "iOS", ver: "18.5", weight: 15, models: ["iPhone 15 Pro", "iPhone 14", "iPad Pro"] },
  { name: "Android", ver: "15", weight: 10, models: ["Pixel 8", "Galaxy S24", "OnePlus 12"] },
];

type Sys = { osName: string; osVersion: string; locale: string; appVersion: string; deviceModel: string | null; sdkVersion: string; isDebug: boolean };
type Evt = { eventName: string; sessionId: string; timestamp: string; props: Record<string, string | number | boolean>; systemProps: Sys };

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const chance = (p: number) => Math.random() < p;
const rid = () => Math.random().toString(36).slice(2, 10);

function pickOs() {
  const total = OSES.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const o of OSES) { r -= o.weight; if (r <= 0) return o; }
  return OSES[0];
}
function makeSys(): Sys {
  const os = pickOs();
  return { osName: os.name, osVersion: os.ver, locale: pick(LOCALES), appVersion: pick(VERSIONS), deviceModel: pick(os.models), sdkVersion: "counted/0.1.0", isDebug: chance(0.02) };
}

/** One realistic session journey starting at `start`, never emitting a future timestamp. */
function buildSession(start: number): Evt[] {
  const now = Date.now();
  const sys = makeSys();
  const sessionId = `sess-${rid()}`;
  const evts: Evt[] = [];
  let t = Math.min(start, now - 1000);
  const add = (eventName: string, props: Record<string, string | number | boolean> = {}) => {
    t = Math.min(t + Math.floor(Math.random() * 90_000) + 5_000, now - 1000); // 5–95s apart, never future
    evts.push({ eventName, sessionId, timestamp: new Date(t).toISOString(), props, systemProps: sys });
  };

  const views = 1 + Math.floor(Math.random() * 4);
  for (let i = 0; i < views; i++) add("page_view", { path: pick(PAGES) });
  if (chance(0.5)) add("button_click", { button: pick(BUTTONS) });
  if (chance(0.25)) add("form_submit", { form: pick(FORMS) });
  if (chance(0.1)) add("share", { channel: pick(CHANNELS) });
  if (chance(0.3)) {
    const plan = pick(PLANS);
    add("sign_up", { plan });
    if (plan !== "free" && chance(0.5)) add("purchase", { plan, price: pick(PRICES) });
  }
  return evts;
}

async function send(key: string, events: Evt[]): Promise<{ sent: number; errors: number }> {
  let sent = 0, errors = 0;
  for (let i = 0; i < events.length; i += MAX_BATCH) {
    const batch = events.slice(i, i + MAX_BATCH);
    try {
      const r = await fetch(`${HOST}/api/v0/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "project-key": key },
        body: JSON.stringify(batch),
      });
      if (r.status === 202) sent += batch.length;
      else { errors += batch.length; console.warn(`[traffic] ${r.status} for ${batch.length} events (key ${key.slice(0, 8)}…)`); }
    } catch (err) {
      errors += batch.length;
      console.warn(`[traffic] send failed: ${(err as Error).message}`);
    }
  }
  return { sent, errors };
}

async function resolveKeys(): Promise<string[]> {
  const fromEnv = process.env.TRAFFIC_KEYS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (fromEnv?.length) return fromEnv;
  // Local convenience: read seeded projects' client keys from the DB.
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("No TRAFFIC_KEYS and no DATABASE_URL — provide client keys to send traffic.");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url });
  const res = await pool.query<{ client_key: string }>(`SELECT client_key FROM projects WHERE client_key IS NOT NULL`);
  await pool.end();
  const keys = res.rows.map((r) => r.client_key);
  if (!keys.length) throw new Error("No projects with client_key found in the database.");
  return keys;
}

const keys = await resolveKeys();
console.log(`[traffic] host=${HOST} projects=${keys.length} rate=${RATE}/min backfill=${BACKFILL_DAYS}d duration=${DURATION_SEC || "∞"}s`);

let totalSent = 0, totalErr = 0;

// ─── Backfill ──────────────────────────────────────────────────────────────────
if (BACKFILL_DAYS > 0) {
  const sessionsPerDayPerProject = 40;
  for (const key of keys) {
    for (let day = BACKFILL_DAYS; day >= 1; day--) {
      const events: Evt[] = [];
      for (let s = 0; s < sessionsPerDayPerProject; s++) {
        const start = Date.now() - day * DAY_MS + Math.floor(Math.random() * DAY_MS);
        events.push(...buildSession(start));
      }
      const { sent, errors } = await send(key, events);
      totalSent += sent; totalErr += errors;
    }
    console.log(`[traffic] backfilled ${BACKFILL_DAYS}d for key ${key.slice(0, 8)}… (${totalSent} events so far)`);
  }
}

// ─── Live loop ───────────────────────────────────────────────────────────────
const startedAt = Date.now();
const eventsPerTick = Math.max(1, Math.round((RATE * TICK_MS) / 60_000));
let running = true;
const stop = (sig: string) => { console.log(`\n[traffic] ${sig} — stopping. sent=${totalSent} errors=${totalErr}`); running = false; };
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

console.log(`[traffic] live: ~${eventsPerTick} events/tick every ${TICK_MS / 1000}s`);
while (running) {
  const events: Evt[] = [];
  while (events.length < eventsPerTick) events.push(...buildSession(Date.now() - Math.floor(Math.random() * 120_000)));
  const key = pick(keys);
  const { sent, errors } = await send(key, events);
  totalSent += sent; totalErr += errors;
  if (DURATION_SEC > 0 && (Date.now() - startedAt) / 1000 >= DURATION_SEC) { stop("duration reached"); break; }
  if (running) await new Promise((r) => setTimeout(r, TICK_MS));
}
console.log(`[traffic] done. sent=${totalSent} errors=${totalErr}`);
