/**
 * The compactor: one object that packs, merges, applies retention and
 * migrates. Run it in your worker, or run `@litics/server`, which is this
 * plus an HTTP surface in a container.
 *
 *   const compactor = createCompactor(cfg, { pool, listen: { url: DIRECT_URL } });
 *   await compactor.migrate();
 *   await compactor.start();
 */
import { type PackOutcome, type ResolvedConfig } from "@litics/core";
import type { Pool } from "pg";
import { type Logger } from "./logger.js";
import { type MaintainReport } from "./maintain.js";
import { type MigrateResult } from "./migrate.js";
import { type PackReport } from "./pack.js";
export type CompactorOptions = {
    pool: Pool;
    /** A direct (non-pooled) URL for LISTEN, or false to rely on the timer alone. Default false. */
    listen?: {
        url: string;
    } | false;
    logger?: Logger;
    /** Timer cadence for the pack job. Default 5 s. */
    packIntervalMs?: number;
    /** Timer cadence for merge/retention/vacuum. Default 10 min. */
    maintenanceIntervalMs?: number;
    /** A partial segment is packed once its oldest row has waited this long. Default 60 s. */
    maxStagingAgeMs?: number;
    /** Rows with ts older than this go to the 'late' series. Default 1 h. */
    lateAfterMs?: number;
    /** Debounce for NOTIFY-triggered packs. Default 250 ms. */
    notifyDebounceMs?: number;
    now?: () => number;
};
export type StreamStatus = {
    stream: string;
    stagingRows: number;
    /** Age of the oldest staged row, or 0 when staging is empty. The lag metric. */
    oldestStagedMs: number;
    segments: number;
    packedEvents: number;
};
export type CompactorStatus = {
    running: boolean;
    listening: boolean;
    lastPackAt: number | null;
    lastMaintainAt: number | null;
    streams: StreamStatus[];
};
export type Compactor = {
    /** Apply migrations once, under the schema lock. */
    migrate(): Promise<MigrateResult>;
    assertSchema(): Promise<void>;
    schemaDrift(): Promise<string[]>;
    /** Start the timers and the listener. */
    start(): Promise<void>;
    /** Stop waking up; wait for in-flight work. */
    stop(): Promise<void>;
    /** One pack pass now (joins one already running). */
    pack(): Promise<PackReport>;
    /** One maintenance pass now. */
    maintain(): Promise<MaintainReport>;
    /** Pack everything in staging, however little — for tests and "make it current". */
    flush(stream?: string, tenant?: string): Promise<PackOutcome[]>;
    status(): Promise<CompactorStatus>;
};
export declare const PACK_JOB = "pack";
export declare const MAINTAIN_JOB = "maintain";
export declare const createCompactor: (cfg: ResolvedConfig, options: CompactorOptions) => Compactor;
