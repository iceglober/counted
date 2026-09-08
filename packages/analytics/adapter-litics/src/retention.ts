/**
 * `EventRetention` over litics' segment tables.
 *
 * One transaction per purge: segments whose newest event is before `before`
 * (their summary rows cascade), then whatever is still in staging before it.
 * A straddling segment is kept whole — the port says so — because a segment
 * is immutable and rewriting one to drop a few rows would cost more than the
 * days it saves. Retention is a promise about the *oldest* data, and this
 * keeps it to within a segment's span.
 *
 * The count returned is events, not rows: a segment row is `n` events, and
 * the number the sweep logs should mean the same thing whether the events
 * had been packed yet or not.
 */

import type { EventRetention, PurgeFailure, PurgeRequest } from "@counted/analytics-ports";
import { err, Instant, ok, unbrand, type Result } from "@counted/kernel";

import { segmentsTable, stagingTable } from "./config";
import type { WritePool } from "./sink";

export type LiticsRetentionDeps = {
  readonly pool: WritePool;
  /** How long one purge may take. Whole segments delete fast; this bounds a pathological tenant. */
  readonly timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

const failureFor = (cause: unknown): PurgeFailure => {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String((cause as { code?: unknown }).code)
      : "";
  if (code === "57014") return { kind: "Timeout" };
  return { kind: "StoreUnavailable", detail: cause instanceof Error ? cause.message : String(cause) };
};

export class LiticsEventRetention implements EventRetention {
  readonly #pool: WritePool;
  readonly #timeoutMs: number;

  constructor(deps: LiticsRetentionDeps) {
    this.#pool = deps.pool;
    this.#timeoutMs = Math.max(1, Math.ceil(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  }

  async purge(request: PurgeRequest): Promise<Result<number, PurgeFailure>> {
    const tenant = unbrand(request.project);
    const before = Instant.toISO(request.before);
    let client;
    try {
      client = await this.#pool.connect();
    } catch (cause) {
      return err(failureFor(cause));
    }
    let discard = false;
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${this.#timeoutMs}`);
      const segments = await client.query<{ n: number }>(
        `DELETE FROM ${segmentsTable()} WHERE tenant_id = $1 AND ts_max < $2::timestamptz RETURNING n`,
        [tenant, before],
      );
      const staged = await client.query(
        `DELETE FROM ${stagingTable()} WHERE tenant_id = $1 AND ts < $2::timestamptz`,
        [tenant, before],
      );
      await client.query("COMMIT");
      const packed = segments.rows.reduce((acc, row) => acc + Number(row.n), 0);
      return ok(packed + (staged.rowCount ?? 0));
    } catch (cause) {
      discard = true;
      return err(failureFor(cause));
    } finally {
      client.release(discard);
    }
  }
}
