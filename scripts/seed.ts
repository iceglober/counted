#!/usr/bin/env bun
/**
 * Seed script — populates a local database with realistic test data.
 *
 * Usage:
 *   bun scripts/seed.ts
 *
 * Requires DATABASE_URL in .env.local or environment.
 */

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../lib/db/schema";
import { generateClientKey, generateServerKey } from "../lib/api-key";
import { createDefaultLayout } from "../lib/default-dashboard";

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://counted:counted@localhost:5434/counted" });
const db = drizzle(pool, { schema });

const PROJECTS = [
  { name: "Counted Web", events: 800 },
  { name: "Mobile App", events: 400 },
  { name: "Marketing Site", events: 200 },
];

const EVENT_NAMES = ["page_view", "button_click", "form_submit", "sign_up", "purchase", "share"];
const PAGES = ["/", "/pricing", "/features", "/docs", "/blog", "/about", "/changelog"];
const OSES = [
  { name: "macOS", ver: "15.5", weight: 40 },
  { name: "Windows", ver: "11", weight: 25 },
  { name: "Linux", ver: "6.8", weight: 15 },
  { name: "iOS", ver: "18.5", weight: 12 },
  { name: "Android", ver: "15", weight: 8 },
];
const LOCALES = ["en-US", "en-US", "en-US", "en-GB", "de-DE", "fr-FR", "ja-JP", "pt-BR", "es-ES"];
const VERSIONS = ["2.4.0", "2.4.0", "2.3.2", "2.3.1", "2.2.0"];
const BUTTONS = ["signup-cta", "pricing-toggle", "docs-link", "github-star", "theme-toggle"];
const FORMS = ["contact", "feedback", "newsletter", "demo-request"];
const CHANNELS = ["twitter", "linkedin", "email", "copy-link"];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function pickWeighted(items: typeof OSES) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) { r -= item.weight; if (r <= 0) return item; }
  return items[0];
}

async function seed() {
  console.log("Seeding database...\n");

  // Enable TimescaleDB if not already
  await pool.query("CREATE EXTENSION IF NOT EXISTS timescaledb").catch(() => {});

  // Push schema
  console.log("Pushing schema...");
  const { execSync } = await import("child_process");
  execSync("bun run db:push", { stdio: "inherit", env: { ...process.env, DATABASE_URL: pool.options.connectionString as string } });

  // Create hypertable (ignore if exists)
  await pool.query("SELECT create_hypertable('events', 'timestamp', if_not_exists => TRUE)").catch(() => {});

  // Create a test user (bypassing better-auth)
  const userId = "seed_user_1";
  await db.insert(schema.user).values({
    id: userId,
    name: "Test User",
    email: "test@counted.dev",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  console.log("Created user: test@counted.dev\n");

  for (const proj of PROJECTS) {
    // Create project
    const clientKey = generateClientKey();
    const [project] = await db.insert(schema.projects).values({
      name: proj.name,
      apiKey: clientKey,
      clientKey,
      serverKey: generateServerKey(),
    }).returning();

    // Add membership
    await db.insert(schema.projectMembers).values({
      projectId: project.id,
      userId,
      role: "owner",
    }).onConflictDoNothing();

    // Create default dashboard
    await db.insert(schema.dashboards).values({
      projectId: project.id,
      name: "Default",
      slug: "default",
      layout: createDefaultLayout(),
      isDefault: true,
    });

    console.log(`Project: ${proj.name} (client: ${clientKey})`);

    // Generate events across 30 days
    const events: typeof schema.events.$inferInsert[] = [];

    for (let day = 1; day <= 30; day++) {
      const date = `2026-05-${String(day).padStart(2, "0")}`;
      const dow = new Date(date).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const sessionCount = isWeekend ? 3 + Math.floor(Math.random() * 5) : 8 + Math.floor(Math.random() * 8);

      for (let s = 0; s < sessionCount; s++) {
        const sid = `${date}-s${s}`;
        const os = pickWeighted(OSES);
        const locale = pick(LOCALES);
        const appVer = pick(VERSIONS);
        const hour = 6 + Math.floor(Math.random() * 16);
        let minute = Math.floor(Math.random() * 50);

        const sys = {
          osName: os.name,
          osVersion: os.ver,
          locale,
          appVersion: appVer,
          sdkVersion: "counted/0.1.0",
          isDebug: false,
        };

        // page_view (always)
        events.push({
          projectId: project.id,
          timestamp: new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`),
          sessionId: sid,
          eventName: "page_view",
          ...sys,
          deviceModel: null,
          props: { path: pick(PAGES) },
        });

        // Additional events
        if (Math.random() < 0.7) {
          minute += 1 + Math.floor(Math.random() * 3);
          events.push({
            projectId: project.id,
            timestamp: new Date(`${date}T${String(hour).padStart(2, "0")}:${String(Math.min(minute, 59)).padStart(2, "0")}:00Z`),
            sessionId: sid,
            eventName: "page_view",
            ...sys,
            deviceModel: null,
            props: { path: pick(PAGES) },
          });
        }

        if (Math.random() < 0.4) {
          minute += 1;
          events.push({
            projectId: project.id,
            timestamp: new Date(`${date}T${String(hour).padStart(2, "0")}:${String(Math.min(minute, 59)).padStart(2, "0")}:00Z`),
            sessionId: sid,
            eventName: "button_click",
            ...sys,
            deviceModel: null,
            props: { id: pick(BUTTONS) },
          });
        }

        if (Math.random() < 0.15) {
          minute += 2;
          events.push({
            projectId: project.id,
            timestamp: new Date(`${date}T${String(hour).padStart(2, "0")}:${String(Math.min(minute, 59)).padStart(2, "0")}:00Z`),
            sessionId: sid,
            eventName: "sign_up",
            ...sys,
            deviceModel: null,
            props: { plan: pick(["free", "free", "free", "pro"]) },
          });
        }

        if (Math.random() < 0.06) {
          minute += 3;
          events.push({
            projectId: project.id,
            timestamp: new Date(`${date}T${String(hour).padStart(2, "0")}:${String(Math.min(minute, 59)).padStart(2, "0")}:00Z`),
            sessionId: sid,
            eventName: "purchase",
            ...sys,
            deviceModel: null,
            props: { plan: "pro", amount: pick([9, 12, 29, 29, 79]) },
          });
        }

        if (Math.random() < 0.2) {
          minute += 1;
          events.push({
            projectId: project.id,
            timestamp: new Date(`${date}T${String(hour).padStart(2, "0")}:${String(Math.min(minute, 59)).padStart(2, "0")}:00Z`),
            sessionId: sid,
            eventName: "form_submit",
            ...sys,
            deviceModel: null,
            props: { form: pick(FORMS) },
          });
        }

        if (Math.random() < 0.15) {
          minute += 1;
          events.push({
            projectId: project.id,
            timestamp: new Date(`${date}T${String(hour).padStart(2, "0")}:${String(Math.min(minute, 59)).padStart(2, "0")}:00Z`),
            sessionId: sid,
            eventName: "share",
            ...sys,
            deviceModel: null,
            props: { channel: pick(CHANNELS) },
          });
        }
      }
    }

    // Insert in batches
    for (let i = 0; i < events.length; i += 100) {
      await db.insert(schema.events).values(events.slice(i, i + 100));
    }

    console.log(`  ${events.length} events across 30 days\n`);
  }

  console.log("Done! Start the dev server with: bun run dev");
  console.log("Login as test@counted.dev (use magic link, check DB for token)");

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
