/**
 * The compactor, as the worker runs it.
 *
 * `@litics/compactor` owns the loop: pack on a timer and on `NOTIFY`, merge
 * small segments, apply retention, vacuum staging, all under per-tenant
 * advisory locks so a second worker replica skips what the first is doing.
 * This file only binds it to Counted's config and logger, because only this
 * package may know litics exists.
 *
 * `LISTEN` needs a direct connection — a transaction-mode pooler does not
 * forward notifications — so the listener takes the direct URL and the timer
 * is the fallback. A worker whose direct URL is really a pooler still packs,
 * on the timer, a few seconds later than it could have.
 */

import { createCompactor, type Compactor, type CompactorStatus, type Logger as LiticsLogger, type LogFields } from "@litics/compactor";

import { resolved } from "./config";
import type { PackPool } from "./pack";

export type { Compactor, CompactorStatus };

/** What the worker's logger looks like; litics' fields may be anything, so they are flattened. */
export type CompactorLogger = {
  info(event: string, fields?: Readonly<Record<string, string | number | boolean | null>>): void;
  warn(event: string, fields?: Readonly<Record<string, string | number | boolean | null>>): void;
  error(event: string, fields?: Readonly<Record<string, string | number | boolean | null>>): void;
};

export type LiticsCompactorDeps = {
  readonly pool: PackPool;
  /** A direct (non-pooled) URL for LISTEN; `null` relies on the timer alone. */
  readonly listenUrl: string | null;
  readonly logger: CompactorLogger;
  readonly packIntervalMs: number;
  readonly maintenanceIntervalMs: number;
  /** A partial segment is packed once its oldest row has waited this long. */
  readonly maxStagingAgeMs: number;
};

const flatten = (fields: LogFields | undefined): Record<string, string | number | boolean | null> => {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    out[key] =
      value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? value
        : JSON.stringify(value) ?? String(value);
  }
  return out;
};

const adaptLogger = (logger: CompactorLogger): LiticsLogger => ({
  info: (message, fields) => logger.info(`compactor.${message}`, flatten(fields)),
  warn: (message, fields) => logger.warn(`compactor.${message}`, flatten(fields)),
  error: (message, fields) => logger.error(`compactor.${message}`, flatten(fields)),
});

export const createLiticsCompactor = (deps: LiticsCompactorDeps): Compactor =>
  createCompactor(resolved, {
    pool: deps.pool,
    listen: deps.listenUrl === null ? false : { url: deps.listenUrl },
    logger: adaptLogger(deps.logger),
    packIntervalMs: deps.packIntervalMs,
    maintenanceIntervalMs: deps.maintenanceIntervalMs,
    maxStagingAgeMs: deps.maxStagingAgeMs,
  });
