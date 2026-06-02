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
// Apply EVERY migration in order (0000, 0001, …), not just the newest. The
// runner is resilient: it runs each statement on its own and continues past
// failures (e.g. an already-applied ADD COLUMN on re-run), so it heals a fresh
// DB from scratch and a partially-migrated one forward.
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
if (files.length === 0) {
  console.log("[migrate] no migration files found, skipping");
  process.exit(0);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000 });

let ok = 0;
let total = 0;
const failures: { file: string; i: number; head: string; error: string }[] = [];

for (const file of files) {
  const sql = readFileSync(`${dir}/${file}`, "utf8");
  const stmts = sql
    .split("--> statement-breakpoint")
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);

  console.log(`[migrate] applying ${stmts.length} statements from ${file}`);
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    total++;
    try {
      await pool.query(s);
      ok++;
    } catch (err) {
      const e = err as { code?: string; message?: string; detail?: string };
      failures.push({ file, i, head: s.split("\n")[0].slice(0, 120), error: `${e.code ?? ""} ${e.message ?? err}`.trim() });
    }
  }
}

console.log(`[migrate] done: ${ok}/${total} ok, ${failures.length} failed`);
for (const f of failures) {
  console.log(`[migrate] ✗ ${f.file} stmt ${f.i}: ${f.head}`);
  console.log(`[migrate]   ${f.error}`);
}

await pool.end();
// Startup use exits 0 so the server always boots; CI sets MIGRATE_STRICT=1 to
// fail loudly if any statement couldn't be applied.
process.exit(process.env.MIGRATE_STRICT === "1" && failures.length ? 1 : 0);
