/**
 * DDL generator: turns a ResolvedConfig into ordered migration steps.
 *
 * Three layers per stream — staging (the hot table events are written to),
 * segments (the immutable columnar tier the compactor packs staging into)
 * and summaries (per-segment, per-hour rollups) — plus shared
 * infrastructure created once: the dims dictionary, the KMV aggregate, and
 * tenancy's reader role and closure table.
 *
 * Nothing here needs an extension. `select count(*) from pg_extension`
 * returning one row (plpgsql) on the target database is the product claim,
 * and a test asserts no statement below mentions one.
 *
 * Each step is an array of single statements (no client-side splitting of
 * plpgsql bodies needed; multi-statement strings break parameterized
 * execution paths in some drivers).
 */
import type { ResolvedConfig } from "./config.js";
/** The NOTIFY channel the staging trigger fires on; the compactor listens here. */
export declare const PACK_CHANNEL = "litics_pack";
export interface MigrationStep {
    /** Stable, ordered name — feeds migration frameworks directly. */
    name: string;
    statements: string[];
}
export declare function generateMigrations(cfg: ResolvedConfig): MigrationStep[];
