#!/usr/bin/env bun
/**
 * Seed script — populates a local database with realistic test data that
 * exercises EVERY insight type, measure, group-by, time bucket, filter
 * operator, funnel, retention period, dashboard feature (share tokens,
 * saved filters, multiple tabs, cross-project insights), alert variety,
 * and project setting.
 *
 * Re-runnable: it truncates the app tables before reseeding.
 *
 * Usage:
 *   bun scripts/seed.ts
 *
 * Requires DATABASE_URL in .env.local or environment.
 */

import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../lib/db/schema";
import { generateClientKey, generateServerKey } from "../lib/api-key";
import type { DashboardLayout, InsightLayout, InsightQuery } from "../lib/types";

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://counted:counted@localhost:5434/counted" });
const db = drizzle(pool, { schema });

// ─── Reference data ──────────────────────────────────────────────────────────

const PAGES = ["/", "/pricing", "/features", "/docs", "/docs/quickstart", "/blog", "/about", "/changelog"];
const BUTTONS = ["signup-cta", "pricing-toggle", "docs-link", "github-star", "theme-toggle", "copy-snippet"];
const FORMS = ["contact", "feedback", "newsletter", "demo-request"];
const CHANNELS = ["twitter", "linkedin", "email", "copy-link", "reddit"];
const PLANS_SIGNUP = ["free", "free", "free", "free", "pro", "pro", "enterprise"];
const PURCHASE_PRICES = [9, 12, 29, 29, 79, 199];
const LOCALES = ["en-US", "en-US", "en-US", "en-GB", "de-DE", "fr-FR", "ja-JP", "pt-BR", "es-ES"];
const VERSIONS = ["2.4.0", "2.4.0", "2.3.2", "2.3.1", "2.2.0"];

const OSES = [
  { name: "macOS", ver: "15.5", weight: 38, models: [null] },
  { name: "Windows", ver: "11", weight: 24, models: [null] },
  { name: "Linux", ver: "6.8", weight: 13, models: [null] },
  { name: "iOS", ver: "18.5", weight: 15, models: ["iPhone 15 Pro", "iPhone 14", "iPad Pro"] },
  { name: "Android", ver: "15", weight: 10, models: ["Pixel 8", "Galaxy S24", "OnePlus 12"] },
];

type Sys = {
  osName: string;
  osVersion: string;
  locale: string;
  appVersion: string;
  deviceModel: string | null;
  sdkVersion: string;
  isDebug: boolean;
};

const PROJECTS = [
  {
    name: "Counted Web",
    scale: 1.0,
    settings: {
      timezone: "America/New_York",
      currency: "USD",
      weekStartsOn: "monday",
      defaultDateRange: "Last 30 days",
      publicDashboards: true,
      dataRetentionDays: 365,
    },
  },
  {
    name: "Mobile App",
    scale: 0.6,
    settings: {
      timezone: "Europe/Berlin",
      currency: "EUR",
      weekStartsOn: "monday",
      defaultDateRange: "Last 7 days",
      publicDashboards: false,
      dataRetentionDays: 90,
    },
  },
  {
    name: "Marketing Site",
    scale: 0.35,
    settings: {
      timezone: "UTC",
      currency: "USD",
      weekStartsOn: "sunday",
      defaultDateRange: "Last 90 days",
      publicDashboards: true,
      dataRetentionDays: 730,
    },
  },
];

// ─── Random helpers ────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function pickWeighted(items: typeof OSES) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) { r -= item.weight; if (r <= 0) return item; }
  return items[0];
}
function makeSys(): Sys {
  const os = pickWeighted(OSES);
  return {
    osName: os.name,
    osVersion: os.ver,
    locale: pick(LOCALES),
    appVersion: pick(VERSIONS),
    deviceModel: pick(os.models),
    sdkVersion: "counted/0.1.0",
    isDebug: Math.random() < 0.02,
  };
}

// ─── Time helpers (relative to real "now" so every range is populated) ──────────

const NOW = new Date();
const DAY_MS = 86_400_000;

function tsFor(dayOffset: number, hour: number, minute: number): Date {
  const d = new Date(NOW.getTime() - dayOffset * DAY_MS);
  d.setHours(hour, minute, 0, 0);
  // Never emit a timestamp in the future (matters for dayOffset 0).
  if (d.getTime() > NOW.getTime()) return new Date(NOW.getTime() - 5 * 60_000);
  return d;
}

// ─── Event emission ──────────────────────────────────────────────────────────

type EventRow = typeof schema.events.$inferInsert;

/**
 * Emit one session's worth of events as a conversion funnel with realistic
 * drop-off: every session views a page; fewer click, fewer sign up, and
 * purchases only happen for sessions that signed up.
 */
function emitSession(events: EventRow[], projectId: string, dayOffset: number, sessionId: string, sys: Sys) {
  const hour = 6 + Math.floor(Math.random() * 16);
  let minute = Math.floor(Math.random() * 45);
  const push = (eventName: string, props: Record<string, unknown>) => {
    minute = Math.min(minute + Math.floor(Math.random() * 3), 59);
    events.push({
      projectId,
      timestamp: tsFor(dayOffset, hour, minute),
      sessionId,
      eventName,
      osName: sys.osName,
      osVersion: sys.osVersion,
      locale: sys.locale,
      appVersion: sys.appVersion,
      deviceModel: sys.deviceModel,
      isDebug: sys.isDebug,
      sdkVersion: sys.sdkVersion,
      props,
    });
  };

  // Step 1 — page view (always), 1-2 of them. load_ms is a numeric prop.
  push("page_view", { path: pick(PAGES), load_ms: 180 + Math.floor(Math.random() * 1800) });
  if (Math.random() < 0.7) push("page_view", { path: pick(PAGES), load_ms: 180 + Math.floor(Math.random() * 1800) });

  // Step 2 — engagement
  if (Math.random() < 0.55) push("button_click", { id: pick(BUTTONS) });
  if (Math.random() < 0.2) push("form_submit", { form: pick(FORMS), fields: 3 + Math.floor(Math.random() * 4) });
  if (Math.random() < 0.15) push("share", { channel: pick(CHANNELS) });

  // Step 3 — sign up
  let signedUp = false;
  if (Math.random() < 0.25) {
    signedUp = true;
    push("sign_up", { plan: pick(PLANS_SIGNUP) });
  }

  // Step 4 — purchase (only after sign up)
  if (signedUp && Math.random() < 0.35) {
    const amount = pick(PURCHASE_PRICES);
    push("purchase", { plan: pick(["pro", "pro", "enterprise"]), amount, items: 1 + Math.floor(Math.random() * 3), mrr: amount });
  }
}

function generateEvents(projectId: string, scale: number): EventRow[] {
  const events: EventRow[] = [];

  // (a) One-off daily sessions — drive volume, breakdowns, time series, funnels.
  for (let dayOffset = 30; dayOffset >= 0; dayOffset--) {
    const date = new Date(NOW.getTime() - dayOffset * DAY_MS);
    const dow = date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const base = isWeekend ? 4 : 11;
    const sessionCount = Math.round((base + Math.floor(Math.random() * 8)) * scale);
    for (let s = 0; s < sessionCount; s++) {
      emitSession(events, projectId, dayOffset, `d${dayOffset}-s${s}`, makeSys());
    }
  }

  // (b) Persistent visitors — same session_id recurs across weeks with decaying
  // return probability, which is what gives the retention heatmap real cohorts.
  const visitorCount = Math.round(70 * scale);
  for (let v = 0; v < visitorCount; v++) {
    const sys = makeSys();
    const joinOffset = 8 + Math.floor(Math.random() * 22); // joined 8-29 days ago
    const sessionId = `visitor-${projectId.slice(0, 8)}-${v}`;
    for (let dayOffset = joinOffset; dayOffset >= 0; dayOffset--) {
      const daysSince = joinOffset - dayOffset;
      const returnProb = Math.max(0.03, 0.3 * Math.pow(0.9, daysSince));
      if (daysSince === 0 || Math.random() < returnProb) {
        emitSession(events, projectId, dayOffset, sessionId, sys);
      }
    }
  }

  return events;
}

// ─── Insight + dashboard builders ──────────────────────────────────────────────

let insightSeq = 0;
function ins(type: InsightLayout["type"], title: string, span: 1 | 2 | 3, query: InsightQuery, projectId?: string): InsightLayout {
  return { id: `ins_${++insightSeq}`, type, title, span, query, ...(projectId ? { projectId } : {}) };
}
const layout = (insights: InsightLayout[]): DashboardLayout => ({ insights });

/** Dashboards for the primary project — one tab per concept, covering everything. */
function primaryDashboards(primaryId: string, otherProjectId: string) {
  const overview = layout([
    ins("metric", "Total events", 1, { measure: "count" }),
    ins("metric", "Unique sessions", 1, { measure: "unique_sessions" }),
    ins("metric", "Unique users", 1, { measure: "unique_users" }),
    ins("metric", "Revenue", 1, { measure: { property: "amount", aggregation: "sum" }, eventFilter: { names: ["purchase"] } }),
    ins("timeseries", "Events over time", 3, { measure: "count", timeBucket: "day" }),
    ins("breakdown", "Top events", 1, { measure: "count", groupBy: [{ type: "system", key: "event_name" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "Top pages", 1, { measure: "count", eventFilter: { names: ["page_view"] }, groupBy: [{ type: "property", key: "path" }], orderBy: { field: "value", direction: "desc" }, limit: 8 }),
    // Cross-project insight: pulls from another project on this dashboard.
    ins("metric", "Mobile sessions (cross-project)", 1, { measure: "unique_sessions" }, otherProjectId),
  ]);

  const metrics = layout([
    ins("metric", "Event count", 1, { measure: "count" }),
    ins("metric", "Unique sessions", 1, { measure: "unique_sessions" }),
    ins("metric", "Unique users", 1, { measure: "unique_users" }),
    ins("metric", "Total revenue (sum)", 1, { measure: { property: "amount", aggregation: "sum" }, eventFilter: { names: ["purchase"] } }),
    ins("metric", "Avg page load ms (avg)", 1, { measure: { property: "load_ms", aggregation: "avg" }, eventFilter: { names: ["page_view"] } }),
    ins("metric", "Smallest order (min)", 1, { measure: { property: "amount", aggregation: "min" }, eventFilter: { names: ["purchase"] } }),
    ins("metric", "Largest order (max)", 1, { measure: { property: "amount", aggregation: "max" }, eventFilter: { names: ["purchase"] } }),
    // Filtered metrics — exercise eq / gt / lt filter operators.
    ins("metric", "Pro purchases (filter: eq)", 1, { measure: "count", eventFilter: { names: ["purchase"], properties: [{ field: "plan", operator: "eq", value: "pro" }] } }),
    ins("metric", "High-value orders (filter: gt)", 1, { measure: "count", eventFilter: { names: ["purchase"], properties: [{ field: "amount", operator: "gt", value: 30 }] } }),
    ins("metric", "Fast page loads (filter: lt)", 1, { measure: "count", eventFilter: { names: ["page_view"], properties: [{ field: "load_ms", operator: "lt", value: 500 }] } }),
  ]);

  const trends = layout([
    ins("timeseries", "Hourly events", 3, { measure: "count", timeBucket: "hour" }),
    ins("timeseries", "Daily events", 3, { measure: "count", timeBucket: "day" }),
    ins("timeseries", "Weekly sessions", 2, { measure: "unique_sessions", timeBucket: "week" }),
    ins("timeseries", "Monthly revenue", 1, { measure: { property: "amount", aggregation: "sum" }, eventFilter: { names: ["purchase"] }, timeBucket: "month" }),
    // Filtered time series — exercise the "contains" operator.
    ins("timeseries", "Docs views over time (filter: contains)", 3, { measure: "count", eventFilter: { names: ["page_view"], properties: [{ field: "path", operator: "contains", value: "docs" }] }, timeBucket: "day" }),
  ]);

  const breakdowns = layout([
    ins("breakdown", "By event name", 2, { measure: "count", groupBy: [{ type: "system", key: "event_name" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "By operating system", 1, { measure: "count", groupBy: [{ type: "system", key: "os_name" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "By OS version", 1, { measure: "count", groupBy: [{ type: "system", key: "os_version" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "By locale", 1, { measure: "count", groupBy: [{ type: "system", key: "locale" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "By app version", 1, { measure: "count", groupBy: [{ type: "system", key: "app_version" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "By device model", 1, { measure: "count", groupBy: [{ type: "system", key: "device_model" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "Top pages (prop)", 2, { measure: "count", eventFilter: { names: ["page_view"] }, groupBy: [{ type: "property", key: "path" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "Signups by plan (prop)", 1, { measure: "count", eventFilter: { names: ["sign_up"] }, groupBy: [{ type: "property", key: "plan" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "Shares by channel (prop)", 1, { measure: "count", eventFilter: { names: ["share"] }, groupBy: [{ type: "property", key: "channel" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "Form submits by form (prop)", 1, { measure: "count", eventFilter: { names: ["form_submit"] }, groupBy: [{ type: "property", key: "form" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "Clicks by button (prop)", 1, { measure: "count", eventFilter: { names: ["button_click"] }, groupBy: [{ type: "property", key: "id" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    // Revenue by plan — a non-count measure on a breakdown.
    ins("breakdown", "Revenue by plan (sum)", 2, { measure: { property: "amount", aggregation: "sum" }, eventFilter: { names: ["purchase"] }, groupBy: [{ type: "property", key: "plan" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    // Filtered breakdowns — exercise "neq" and "in" operators.
    ins("breakdown", "Pages excl. Windows (filter: neq)", 2, { measure: "count", eventFilter: { names: ["page_view"], properties: [{ field: "os_name", operator: "neq", value: "Windows" }] }, groupBy: [{ type: "property", key: "path" }], orderBy: { field: "value", direction: "desc" }, limit: 8 }),
    ins("breakdown", "Paid signups by plan (filter: in)", 1, { measure: "count", eventFilter: { names: ["sign_up"], properties: [{ field: "plan", operator: "in", value: ["pro", "enterprise"] }] }, groupBy: [{ type: "property", key: "plan" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
  ]);

  const funnels = layout([
    ins("funnel", "Acquisition funnel", 2, { measure: "count", funnelSteps: ["page_view", "button_click", "sign_up", "purchase"] }),
    ins("funnel", "Signup funnel", 1, { measure: "count", funnelSteps: ["page_view", "sign_up"] }),
    ins("funnel", "Engagement funnel", 2, { measure: "count", funnelSteps: ["page_view", "button_click", "share"] }),
    ins("funnel", "Lead funnel", 1, { measure: "count", funnelSteps: ["page_view", "form_submit"] }),
  ]);

  const retention = layout([
    ins("retention", "Daily retention", 3, { measure: "count", retentionPeriod: "day", retentionPeriods: 10 }),
    ins("retention", "Weekly retention", 3, { measure: "count", retentionPeriod: "week", retentionPeriods: 8 }),
    ins("retention", "Monthly retention", 3, { measure: "count", retentionPeriod: "month", retentionPeriods: 4 }),
  ]);

  // Public snapshot — a lean dashboard meant to be shared publicly.
  const publicSnapshot = layout([
    ins("metric", "Total events", 1, { measure: "count" }),
    ins("metric", "Unique sessions", 1, { measure: "unique_sessions" }),
    ins("metric", "Revenue", 1, { measure: { property: "amount", aggregation: "sum" }, eventFilter: { names: ["purchase"] } }),
    ins("timeseries", "Daily events", 3, { measure: "count", timeBucket: "day" }),
    ins("breakdown", "Top pages", 3, { measure: "count", eventFilter: { names: ["page_view"] }, groupBy: [{ type: "property", key: "path" }], orderBy: { field: "value", direction: "desc" }, limit: 8 }),
  ]);

  return [
    { projectId: primaryId, name: "Overview", slug: "overview", layout: overview, isDefault: true, filters: {} },
    { projectId: primaryId, name: "Metrics", slug: "metrics", layout: metrics, isDefault: false, filters: {} },
    {
      projectId: primaryId, name: "Trends", slug: "trends", layout: trends, isDefault: false,
      // Saved dashboard-level filters (exercises the filters JSONB column).
      filters: { timeRange: { type: "relative", value: 7, unit: "days" }, eventNames: ["page_view", "sign_up"] },
    },
    { projectId: primaryId, name: "Breakdowns", slug: "breakdowns", layout: breakdowns, isDefault: false, filters: {} },
    { projectId: primaryId, name: "Funnels", slug: "funnels", layout: funnels, isDefault: false, filters: {} },
    { projectId: primaryId, name: "Retention", slug: "retention", layout: retention, isDefault: false, filters: {} },
    {
      projectId: primaryId, name: "Public Snapshot", slug: "public-snapshot", layout: publicSnapshot, isDefault: false,
      filters: {}, shareToken: randomBytes(16).toString("hex"),
    },
  ];
}

/** A lighter dashboard set for secondary projects. */
function secondaryDashboards(projectId: string) {
  const overview = layout([
    ins("metric", "Total events", 1, { measure: "count" }),
    ins("metric", "Unique sessions", 1, { measure: "unique_sessions" }),
    ins("metric", "Signups", 1, { measure: "count", eventFilter: { names: ["sign_up"] } }),
    ins("timeseries", "Events over time", 3, { measure: "count", timeBucket: "day" }),
    ins("breakdown", "Top events", 2, { measure: "count", groupBy: [{ type: "system", key: "event_name" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
    ins("breakdown", "By OS", 1, { measure: "count", groupBy: [{ type: "system", key: "os_name" }], orderBy: { field: "value", direction: "desc" }, limit: 10 }),
  ]);
  const insightsTab = layout([
    ins("funnel", "Signup funnel", 2, { measure: "count", funnelSteps: ["page_view", "sign_up", "purchase"] }),
    ins("retention", "Weekly retention", 3, { measure: "count", retentionPeriod: "week", retentionPeriods: 6 }),
    ins("breakdown", "Pages", 1, { measure: "count", eventFilter: { names: ["page_view"] }, groupBy: [{ type: "property", key: "path" }], orderBy: { field: "value", direction: "desc" }, limit: 8 }),
  ]);
  return [
    { projectId, name: "Overview", slug: "overview", layout: overview, isDefault: true, filters: {} },
    { projectId, name: "Insights", slug: "insights", layout: insightsTab, isDefault: false, filters: {} },
  ];
}

// ─── Alert builders ──────────────────────────────────────────────────────────

function buildAlerts(primaryId: string, mobileId: string, userId: string) {
  const hourAgo = new Date(NOW.getTime() - 30 * 60_000);
  return [
    // count above, daily window, email, already triggered.
    { projectId: primaryId, createdBy: userId, name: "Traffic spike", metric: "count", eventFilter: null, condition: "above", threshold: "1000", window: "24h", channels: ["email"], slackWebhookUrl: null, enabled: true, lastTriggeredAt: hourAgo, lastValue: "1432" },
    // unique_sessions below, hourly window, email + slack.
    { projectId: primaryId, createdBy: userId, name: "Sessions dropped", metric: "unique_sessions", eventFilter: null, condition: "below", threshold: "5", window: "1h", channels: ["email", "slack"], slackWebhookUrl: "https://hooks.slack.com/services/T000/B000/seedwebhook", enabled: true, lastTriggeredAt: null, lastValue: "12" },
    // count above on a specific event, weekly window.
    { projectId: primaryId, createdBy: userId, name: "Purchases this week", metric: "count", eventFilter: "purchase", condition: "above", threshold: "10", window: "7d", channels: ["email"], slackWebhookUrl: null, enabled: true, lastTriggeredAt: null, lastValue: "37" },
    // custom property sum metric (revenue), monthly window, slack only.
    { projectId: primaryId, createdBy: userId, name: "Monthly revenue target", metric: "amount", eventFilter: "purchase", condition: "above", threshold: "500", window: "30d", channels: ["slack"], slackWebhookUrl: "https://hooks.slack.com/services/T000/B000/revwebhook", enabled: true, lastTriggeredAt: null, lastValue: "2841" },
    // a disabled alert.
    { projectId: primaryId, createdBy: userId, name: "Error budget (paused)", metric: "count", eventFilter: "form_submit", condition: "above", threshold: "999999", window: "1h", channels: ["email"], slackWebhookUrl: null, enabled: false, lastTriggeredAt: null, lastValue: null },
    // alerts on a second project.
    { projectId: mobileId, createdBy: userId, name: "Mobile signups low", metric: "count", eventFilter: "sign_up", condition: "below", threshold: "3", window: "24h", channels: ["email"], slackWebhookUrl: null, enabled: true, lastTriggeredAt: null, lastValue: "8" },
  ];
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log("Seeding database...\n");

  await pool.query("CREATE EXTENSION IF NOT EXISTS timescaledb").catch(() => {});

  console.log("Pushing schema...");
  const { execSync } = await import("child_process");
  execSync("bun run db:push", { stdio: "inherit", env: { ...process.env, DATABASE_URL: pool.options.connectionString as string } });

  await pool.query("SELECT create_hypertable('events', 'timestamp', if_not_exists => TRUE)").catch(() => {});

  // Idempotent: wipe app data so re-runs start clean.
  console.log("Clearing existing app data...");
  await pool.query("TRUNCATE alerts, events, dashboards, project_members, projects RESTART IDENTITY CASCADE");

  const userId = "seed_user_1";
  await db.insert(schema.user).values({
    id: userId,
    name: "Test User",
    email: "test@counted.dev",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();
  // Pro plan so the fixture isn't constrained by the free 3-project cap — the
  // suite creates several projects across tests. (The cap is still enforced for
  // real free users; nothing here asserts free-tier behavior.)
  await db.insert(schema.subscriptions).values({
    id: "seed_sub_1",
    userId,
    stripeCustomerId: "cus_seed_test",
    plan: "pro",
    status: "active",
  }).onConflictDoNothing();
  console.log("User: test@counted.dev (pro)\n");

  const projectIds: string[] = [];

  for (const proj of PROJECTS) {
    const clientKey = generateClientKey();
    const [project] = await db.insert(schema.projects).values({
      name: proj.name,
      apiKey: clientKey,
      clientKey,
      serverKey: generateServerKey(),
      settings: proj.settings,
    }).returning();
    projectIds.push(project.id);

    await db.insert(schema.projectMembers).values({
      projectId: project.id,
      userId,
      role: "owner",
    }).onConflictDoNothing();

    const events = generateEvents(project.id, proj.scale);
    for (let i = 0; i < events.length; i += 500) {
      await db.insert(schema.events).values(events.slice(i, i + 500));
    }
    console.log(`Project: ${proj.name} (client: ${clientKey}) — ${events.length} events`);
  }

  const [primaryId, mobileId, marketingId] = projectIds;

  // Dashboards
  const dashboardRows = [
    ...primaryDashboards(primaryId, mobileId),
    ...secondaryDashboards(mobileId),
    ...secondaryDashboards(marketingId),
  ];
  // Dashboards are user-owned with one default per user.
  let defaultAssigned = false;
  await db.insert(schema.dashboards).values(dashboardRows.map((d) => {
    const isDefault = !!d.isDefault && !defaultAssigned;
    if (isDefault) defaultAssigned = true;
    return {
      userId,
      projectId: d.projectId,
      name: d.name,
      slug: d.slug,
      layout: d.layout,
      filters: d.filters,
      isDefault,
      shareToken: (d as { shareToken?: string }).shareToken ?? null,
    };
  }));
  console.log(`\nDashboards: ${dashboardRows.length} (${dashboardRows.filter((d) => "shareToken" in d).length} shared)`);

  // Alerts
  const alertRows = buildAlerts(primaryId, mobileId, userId);
  await db.insert(schema.alerts).values(alertRows);
  console.log(`Alerts: ${alertRows.length}`);

  console.log("\nDone! Start the dev server with: bun run dev");
  console.log("Login as test@counted.dev (magic link — check the verification table for the token)");

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
