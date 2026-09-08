/**
 * The ledgered migrator: applies every generated step once, in order,
 * under litics' own schema lock, and tells you whether the live schema
 * matches the config afterwards.
 *
 * One transaction per step. The ledger row is written in the same
 * transaction as the step's DDL (Postgres DDL is transactional), so a
 * crash mid-step leaves nothing applied and nothing recorded. Concurrent
 * appliers — several replicas booting at once — serialise on the advisory
 * lock and each sees the ledger the previous one wrote.
 */
import { type ColumnSpec, type ResolvedConfig } from "@litics/core";
import type { Pool } from "pg";
import type { Logger } from "./logger.js";
export type MigrateResult = {
    applied: string[];
    skipped: string[];
};
export declare const LEDGER = "litics_migrations";
export declare const migrate: (pool: Pool, cfg: ResolvedConfig, opts?: {
    logger?: Logger;
}) => Promise<MigrateResult>;
/** Every column of every table in the litics schema, as `diffSchema` wants it. */
export declare const liveColumns: (pool: Pool, cfg: ResolvedConfig) => Promise<ColumnSpec[]>;
/** Human-readable drift between the config and the live schema; empty means none. */
export declare const schemaDrift: (pool: Pool, cfg: ResolvedConfig) => Promise<string[]>;
/** Throw unless the live schema matches the config exactly. */
export declare const assertSchema: (pool: Pool, cfg: ResolvedConfig) => Promise<void>;
