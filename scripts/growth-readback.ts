#!/usr/bin/env bun
/**
 * Growth dashboard read-back — the read side of the agentic growth loop.
 *
 * Defines the "Growth" dashboard insights as typed Management-API queries and
 * runs them against the marketing/growth project through the SAME public client
 * (@counted/api) that customers use. This does double duty:
 *   1. It is the canonical spec of what the Growth dashboard measures
 *      (source -> conversion), as code, version-controlled alongside the site.
 *   2. It dogfoods the Management API and proves agents can read results back
 *      to decide the next content/distribution move (ROADMAP phase 2 -> 3).
 *
 * Attribution (channel / utm_* / referrer_host / landing_path) is attached to
 * every marketing event by app/(marketing)/analytics.ts, so these group-bys
 * resolve the source dimension without any extra instrumentation.
 *
 * CAC / spend -> conversion is intentionally NOT here: cost lives in the
 * separate finance project (see internal financial-ops.md). This script covers
 * traffic -> signup-intent only.
 *
 * Env:
 *   GROWTH_HOST           default https://app.counted.dev
 *   GROWTH_SESSION_TOKEN  better-auth session token (read scope) — required
 *   GROWTH_PROJECT_ID     the marketing/growth project id — required
 *   GROWTH_WINDOW_DAYS    lookback window in days (default 30)
 *
 * Run:
 *   GROWTH_SESSION_TOKEN=... GROWTH_PROJECT_ID=... bun scripts/growth-readback.ts
 */
export {};

import { CountedClient, type InsightQuery, type TimeRange } from "@counted/api";

const HOST = (process.env.GROWTH_HOST ?? "https://app.counted.dev").replace(/\/$/, "");
const SESSION_TOKEN = process.env.GROWTH_SESSION_TOKEN;
const PROJECT_ID = process.env.GROWTH_PROJECT_ID;
const WINDOW_DAYS = Number(process.env.GROWTH_WINDOW_DAYS ?? 30);

if (!SESSION_TOKEN || !PROJECT_ID) {
  console.error(
    "Missing GROWTH_SESSION_TOKEN and/or GROWTH_PROJECT_ID.\n" +
      "Get a session token from an authenticated browser session and the project id from the URL.",
  );
  process.exit(1);
}

const timeRange: TimeRange = { type: "relative", value: WINDOW_DAYS, unit: "days" };

// ─── The Growth dashboard, as code ──────────────────────────────────────────
// Each entry is one insight on the dashboard. Mirror these as saved insights in
// the UI, or let a later task provision them via createDashboard.

const INSIGHTS: { name: string; description: string; query: InsightQuery }[] = [
  {
    name: "Traffic by channel",
    description: "Page views grouped by acquisition channel (the source dimension).",
    query: {
      measure: "count",
      eventFilter: { names: ["page_view"] },
      groupBy: [{ type: "property", key: "channel" }],
      orderBy: { field: "value", direction: "desc" },
      limit: 20,
    },
  },
  {
    name: "Signup-intent by channel",
    description: "CTA clicks (signup intent) grouped by channel — the numerator for conversion.",
    query: {
      measure: "count",
      eventFilter: { names: ["cta_click"] },
      groupBy: [{ type: "property", key: "channel" }],
      orderBy: { field: "value", direction: "desc" },
      limit: 20,
    },
  },
  {
    name: "Top landing pages",
    description: "Entry pages — page_view grouped by landing_path (the session's first-touch page).",
    query: {
      measure: "unique_sessions",
      eventFilter: { names: ["page_view"] },
      groupBy: [{ type: "property", key: "landing_path" }],
      orderBy: { field: "value", direction: "desc" },
      limit: 20,
    },
  },
  {
    name: "Page views by path",
    description: "Which pages get viewed — page_view grouped by path.",
    query: {
      measure: "count",
      eventFilter: { names: ["page_view"] },
      groupBy: [{ type: "property", key: "path" }],
      orderBy: { field: "value", direction: "desc" },
      limit: 20,
    },
  },
  {
    name: "CTA clicks by surface",
    description: "Which pages convert — cta_click grouped by the location prop.",
    query: {
      measure: "count",
      eventFilter: { names: ["cta_click"] },
      groupBy: [{ type: "property", key: "location" }],
      orderBy: { field: "value", direction: "desc" },
      limit: 20,
    },
  },
  {
    name: "Top campaigns",
    description: "Page views grouped by utm_campaign — which campaigns drive traffic.",
    query: {
      measure: "count",
      eventFilter: { names: ["page_view"], properties: [{ field: "utm_campaign", operator: "neq", value: "" }] },
      groupBy: [{ type: "property", key: "utm_campaign" }],
      orderBy: { field: "value", direction: "desc" },
      limit: 20,
    },
  },
  {
    name: "Source -> signup funnel",
    description: "Visit -> signup-intent -> signup conversion across the whole site.",
    query: {
      measure: "count",
      funnelSteps: ["page_view", "cta_click", "signup"],
    },
  },
];

const client = new CountedClient({ host: HOST, sessionToken: SESSION_TOKEN });

console.log(`\nGrowth read-back — last ${WINDOW_DAYS}d — project ${PROJECT_ID} @ ${HOST}\n`);

let failures = 0;
for (const insight of INSIGHTS) {
  try {
    const res = await client.query(PROJECT_ID, insight.query, timeRange);
    console.log(`■ ${insight.name}`);
    console.log(`  ${insight.description}`);
    const rows = res.data ?? [];
    if (rows.length === 0) {
      console.log("  (no data yet)\n");
    } else {
      for (const row of rows.slice(0, 20)) {
        console.log(`  ${JSON.stringify(row)}`);
      }
      console.log("");
    }
  } catch (err) {
    failures++;
    console.log(`■ ${insight.name}\n  ERROR: ${(err as Error).message}\n`);
  }
}

if (failures > 0) {
  console.error(`${failures} insight(s) failed.`);
  process.exit(1);
}
console.log("Read-back complete.");
