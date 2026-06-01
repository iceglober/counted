#!/usr/bin/env bun
/**
 * Resilient migration runner for startup.
 *
 * `drizzle-kit migrate` wraps the whole migration in one transaction and hides
 * the failing SQL behind its spinner, so a single bad statement (e.g. a
 * TimescaleDB hypertable interaction) aborts the entire heal and we can't see
 * why. Every statement in our baseline is idempotent (IF NOT EXISTS / guarded),
 * so here we run them one at a time, continue past failures, and log exactly
 * what failed. This heals all the drift that CAN be applied (the critical
 * ADD COLUMNs run first) and surfaces the real error.
 *
 * Exits 0 so the server always starts.
 */
import { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";

const dir = "drizzle";
const file = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().pop();
if (!file) {
  console.log("[migrate] no migration file found, skipping");
  process.exit(0);
}

const sql = readFileSync(`${dir}/${file}`, "utf8");
const stmts = sql
  .split("--> statement-breakpoint")
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000 });

let ok = 0;
const failures: { i: number; head: string; error: string }[] = [];

console.log(`[migrate] applying ${stmts.length} statements from ${file}`);
for (let i = 0; i < stmts.length; i++) {
  const s = stmts[i];
  try {
    await pool.query(s);
    ok++;
  } catch (err) {
    const e = err as { code?: string; message?: string; detail?: string };
    failures.push({ i, head: s.split("\n")[0].slice(0, 120), error: `${e.code ?? ""} ${e.message ?? err}`.trim() });
  }
}

console.log(`[migrate] done: ${ok}/${stmts.length} ok, ${failures.length} failed`);
for (const f of failures) {
  console.log(`[migrate] ✗ stmt ${f.i}: ${f.head}`);
  console.log(`[migrate]   ${f.error}`);
}

await pool.end();
// Startup use exits 0 so the server always boots; CI sets MIGRATE_STRICT=1 to
// fail loudly if any statement couldn't be applied.
process.exit(process.env.MIGRATE_STRICT === "1" && failures.length ? 1 : 0);
