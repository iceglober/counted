/**
 * Schema drift detection. The config generates the DDL, but nothing stops a
 * config from being edited AFTER its migrations ran — the migrator won't
 * re-run executed steps, and the builders would happily emit SQL against
 * columns that don't exist. expectedSchema()/diffSchema() compare the
 * config's intent against what information_schema actually reports;
 * adapters run the introspection query and call diffSchema at startup.
 */
import type { ResolvedConfig } from "./config.js";
export interface ColumnSpec {
    /** Table name, unqualified (the introspection query is schema-scoped). */
    table: string;
    column: string;
    /** Postgres internal type name as information_schema reports it (udt_name). */
    udt: string;
}
export declare function expectedSchema(cfg: ResolvedConfig): ColumnSpec[];
/**
 * Compare the config's expected schema against introspected columns.
 * `actual` is every column in the litics schema (unknown tables are
 * ignored — only expected tables are checked). Returns human-readable
 * issues; empty array = no drift.
 */
export declare function diffSchema(cfg: ResolvedConfig, actual: ColumnSpec[]): string[];
