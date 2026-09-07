/**
 * EventSink over litics trackBatch. The durable receipt ledger and analytics
 * rows share one transaction: a retry after packing or a server restart still
 * sees the original receipt. A failed write rolls both back.
 *
 * The ledger stores only a digest of the SDK event key plus occurredAt, scoped
 * to the project. It is an event retry receipt, never a visitor identity. Keys
 * survive for the project lifetime and cascade when the project is deleted;
 * packing or analytics retention must not make old retries count again.
 */

import { createHash } from "node:crypto";
import { PACK_CHANNEL, trackBatch, type SqlStatement, type TrackEvent } from "@litics/core";
import type { AdmittedEvent } from "@counted/ingestion-domain";
import type { EventSink, WriteFailure, WriteReceipt } from "@counted/ingestion-ports";
import { Instant, ProjectId, unbrand, err, ok, type Result } from "@counted/kernel";

import { resolved, resolvedStream, STREAM } from "./config";

/**
 * The narrowest shape the sink needs from a `pg` pool.
 *
 * Structural for the same reasons `QueryPool` is (see `execute.ts`): nothing
 * here imports the driver, and a test supplies a fake without a cast. Writes
 * take a connection of their own rather than going through `execute`, which
 * opens `BEGIN READ ONLY` and would refuse an INSERT.
 */
export interface WriteClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
  release(destroy?: boolean): void;
}

export interface WritePool {
  connect(): Promise<WriteClient>;
}

export type LiticsSinkDeps = {
  readonly pool: WritePool;
  /**
   * How long one batch write may take, in milliseconds.
   *
   * Enforced with `SET LOCAL statement_timeout`, so a write that is stuck
   * behind a lock gives the connection back instead of holding a group commit's
   * waiters open forever. `SET LOCAL` rather than `SET` because the connection
   * goes back to a pool and a timeout nobody asked for is the kind of setting
   * that is discovered months later on an unrelated query.
   */
  readonly writeTimeoutMs?: number;
};

/** Generous: a group commit is one INSERT of at most a few hundred rows. */
const DEFAULT_WRITE_TIMEOUT_MS = 5_000;

/**
 * The channel the compactor listens on — litics' own constant, re-exported so
 * the test and the worker name it from here. A batch commit notifies it with
 * the project id as payload.
 */
export { PACK_CHANNEL };

/** The dimensions the stream declares, resolved once rather than per event. */
const DIMENSION_NAMES: readonly string[] = resolvedStream.dimensions.map((d) => d.name);

/** Postgres codes that mean something specific enough to name. */
const failureFor = (cause: unknown): WriteFailure => {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String((cause as { code?: unknown }).code)
      : "";
  const detail = cause instanceof Error ? cause.message : String(cause);

  if (code === "57014") return { kind: "Timeout" };
  if (code === "42P01" || code === "3F000") {
    return {
      kind: "SinkUnavailable",
      detail: `the analytics schema is not present — run the domain and litics migrations (${detail})`,
    };
  }
  return { kind: "SinkUnavailable", detail };
};

/**
 * One admitted event as litics wants it.
 *
 * `eventId` is deliberately left unset so the statement's
 * `coalesce(…, gen_random_uuid())` mints one. `AdmittedEvent.dedupKey` is not
 * a UUID — it is whatever the SDK chose — and casting it to `uuid` would turn
 * a client's idempotency key into a 22P02 on the hot path.
 */
export const toTrackEvent = (event: AdmittedEvent): TrackEvent => {
  const props: Record<string, unknown> = { ...event.properties };
  if (event.person !== null) props["$person"] = unbrand(event.person);
  if (event.system.os_name_raw !== null) props["$os_name_raw"] = event.system.os_name_raw;

  const system = event.system as unknown as Record<string, string | null>;
  const dims: Record<string, string | null> = {};
  for (const name of DIMENSION_NAMES) dims[name] = system[name] ?? null;

  return {
    actor: unbrand(event.visit),
    type: event.name,
    ts: new Date(Instant.toEpochMillis(event.occurredAt)),
    props,
    dims,
  };
};

/** The statement one batch becomes. Exported so a test can read it without a database. */
export const writeStatement = (
  project: ProjectId,
  events: readonly AdmittedEvent[],
): SqlStatement =>
  trackBatch(
    resolved,
    STREAM,
    events.map((event) => ({ ...toTrackEvent(event), tenant: unbrand(project) })),
  );

export class LiticsEventSink implements EventSink<AdmittedEvent> {
  readonly #pool: WritePool;
  readonly #timeoutMs: number;

  constructor(deps: LiticsSinkDeps) {
    this.#pool = deps.pool;
    this.#timeoutMs = Math.max(1, Math.ceil(deps.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS));
  }

  async writeBatch(
    project: ProjectId,
    events: readonly AdmittedEvent[],
  ): Promise<Result<WriteReceipt, WriteFailure>> {
    if (events.length === 0) return ok({ written: 0, writtenIndices: [], deduplicated: 0 });

    // Hash the opaque key whole; it includes a NUL separator that PostgreSQL
    // text cannot store. Prefixing the project keeps receipts project-scoped
    // even if customers reuse the same event key across projects.
    const digests = events.map((event) => event.dedupKey === null ? null :
      createHash("sha256").update(unbrand(project)).update("\0").update(event.dedupKey).digest("hex"));

    let client: WriteClient;
    try {
      client = await this.#pool.connect();
    } catch (cause) {
      return err(failureFor(cause));
    }

    let discard = false;
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${this.#timeoutMs}`);
      const keys = [...new Set(digests.filter((digest): digest is string => digest !== null))].sort();
      const reserved = keys.length === 0 ? [] : (await client.query<{ digest: string }>(
        `INSERT INTO public.ingest_receipts (project_id, key_digest)
         SELECT $1, decode(digest, 'hex') FROM unnest($2::text[]) AS keys(digest) ORDER BY digest
         ON CONFLICT DO NOTHING RETURNING encode(key_digest, 'hex') AS digest`,
        [unbrand(project), keys],
      )).rows;
      // Ordered unique-key reservation avoids deadlocks for overlapping batches.
      // ON CONFLICT waits for concurrent writers, then identifies exactly which
      // events this transaction owns, even when another process won the race.
      const fresh = new Set(reserved.map((row) => row.digest));
      const writtenIndices: number[] = [];
      const pending = events.filter((_, index) => {
        const digest = digests[index]!;
        if (digest !== null && !fresh.delete(digest)) return false;
        writtenIndices.push(index);
        return true;
      });
      if (pending.length > 0) {
        const statement = writeStatement(project, pending);
        const result = await client.query(statement.sql, statement.parameters as unknown[]);
        if (result.rowCount !== pending.length) throw new Error("analytics write count did not match the reserved batch");
      // Wake the compactor. Inside the transaction on purpose: a notification
      // is delivered only when the transaction commits, so a rolled-back batch
      // wakes nobody, and Postgres collapses identical (channel, payload) pairs
      // within one transaction so a busy project costs one wake-up per commit.
      // `pg_notify` rather than bare NOTIFY so the payload is a bound
      // parameter. The payload is the project id — well under the 8000-byte
      // cap, and all the compactor needs to know which tenant to look at.
        await client.query("SELECT pg_notify($1, $2)", [PACK_CHANNEL, unbrand(project)]);
      }
      await client.query("COMMIT");
      return ok({ written: writtenIndices.length, writtenIndices, deduplicated: events.length - writtenIndices.length });
    } catch (cause) {
      discard = true;
      return err(failureFor(cause));
    } finally {
      client.release(discard);
    }
  }
}
