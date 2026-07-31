/**
 * The Postgres AnalyticalStore.
 *
 * Three things it does that v1's loader did not.
 *
 * **It coalesces.** Two tiles asking the same question run one statement, and
 * both get the answer. v1 ran identical queries twice within a single
 * dashboard load because nothing compared them — `Analysis.toKey` exists so
 * this comparison is cheap and total.
 *
 * **It answers per request.** One failing question produces one failed
 * `Outcome`; the rest of the batch still returns numbers. v1 wrapped
 * everything in `Promise.allSettled` and mapped each rejection to
 * `emptyData()`, so a broken query and an empty project were indistinguishable
 * on screen. `Outcome` has no zero value, so that mapping cannot be written.
 *
 * **It honours a deadline.** The batch has a budget; a query that overruns
 * becomes a `timeout` outcome carrying that budget, not a hanging request or a
 * raw driver error.
 */

import type { Pool, PoolClient } from "pg";
import {
  Analysis,
  Instant,
  TimeAxis,
  type Funnel,
  type Retention,
} from "@counted/domain";
import type {
  AnalyticalStore,
  BatchOutcome,
  ExecOptions,
  Outcome,
  RequestId,
  StoreCapabilities,
  StoreError,
  StoreRequest,
  StoreResult,
} from "@counted/ports";
import { Params } from "./compile/params";
import { breakdownDimension, compileBreakdown, compileScalar, compileSeries } from "./compile/statements";
import { compileSequence, readSequenceRow } from "./compile/sequence";
import { compileCohorts, readCohortRows, type CohortRow } from "./compile/cohorts";
import { measureMayBeNull } from "./compile/measure";

const DEFAULT_BREAKDOWN_LIMIT = 10;

/**
 * Identity of a question, for coalescing. Two requests sharing this key are
 * the same query and are executed once.
 */
const coalesceKey = (r: StoreRequest): string => {
  const bounds = `${Instant.toEpochMillis(r.bounds.from)}-${Instant.toEpochMillis(r.bounds.to)}`;
  switch (r.kind) {
    case "scalar":
    case "breakdown":
      return `${r.kind}|${r.project}|${bounds}|${Analysis.toKey(r.analysis)}`;
    case "series":
      // The axis is part of the question: the same analysis over a different
      // grain is a different query.
      return `series|${r.project}|${bounds}|${Analysis.toKey(r.analysis)}|${r.axis.grain}|${r.axis.edges.length}`;
    case "sequence":
      return `sequence|${r.project}|${bounds}|${JSON.stringify(r.funnel)}`;
    case "cohorts":
      return `cohorts|${r.project}|${bounds}|${JSON.stringify(r.retention)}`;
  }
};

const toStoreError = (e: unknown, budgetMs: number): StoreError => {
  const code = (e as { code?: string }).code;
  const message = e instanceof Error ? e.message : String(e);

  // 57014 = query_canceled, which is what statement_timeout raises.
  if (code === "57014" || /timeout/i.test(message)) {
    return { code: "timeout", budgetMs, retriable: true };
  }
  // Connection-level trouble is worth retrying; a malformed query is not.
  if (code === "08006" || code === "08003" || code === "53300" || /connect/i.test(message)) {
    return { code: "store_unavailable", detail: message, retriable: true };
  }
  return { code: "invalid_request", detail: message, retriable: false };
};

export class PostgresAnalyticalStore implements AnalyticalStore {
  constructor(
    private readonly pool: Pool,
    private readonly caps: StoreCapabilities,
  ) {}

  capabilities(): StoreCapabilities {
    return this.caps;
  }

  async executeBatch(requests: readonly StoreRequest[], options: ExecOptions): Promise<BatchOutcome> {
    const startedAt = Date.now();
    const results = new Map<RequestId, Outcome<StoreResult>>();

    // Group by question. The first request of each group is executed; the rest
    // are answered from it.
    const groups = new Map<string, StoreRequest[]>();
    for (const request of requests) {
      const key = coalesceKey(request);
      groups.set(key, [...(groups.get(key) ?? []), request]);
    }

    const deadline = startedAt + options.deadlineMs;
    let statements = 0;

    await Promise.all(
      [...groups.values()].map(async (group) => {
        const representative = group[0]!;
        const remaining = deadline - Date.now();
        statements++;

        let outcome: Outcome<StoreResult>;
        if (remaining <= 0) {
          outcome = { ok: false, error: { code: "timeout", budgetMs: options.deadlineMs, retriable: true } };
        } else {
          outcome = await this.runOne(representative, remaining, options.signal);
        }
        for (const request of group) results.set(request.id, outcome);
      }),
    );

    return {
      results,
      stats: {
        statements,
        totalMs: Date.now() - startedAt,
        coalesced: requests.length - groups.size,
      },
    };
  }

  private async runOne(
    request: StoreRequest,
    budgetMs: number,
    signal: AbortSignal | undefined,
  ): Promise<Outcome<StoreResult>> {
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.trunc(budgetMs))}`);
      if (signal?.aborted === true) {
        return { ok: false, error: { code: "timeout", budgetMs, retriable: true } };
      }

      const value = await this.execute(client, request);
      return { ok: true, value, from: "store", computedAt: Instant.fromEpochMillis(Date.now()) };
    } catch (e) {
      return { ok: false, error: toStoreError(e, budgetMs) };
    } finally {
      client?.release();
    }
  }

  private async execute(client: PoolClient, request: StoreRequest): Promise<StoreResult> {
    const params = new Params();

    switch (request.kind) {
      case "scalar": {
        const spec = this.spec(request);
        const rows = (await client.query(compileScalar(spec, params), [...params.all])).rows;
        const raw = rows[0]?.value;
        // AVG/MIN/MAX over nothing are genuinely NULL; the reader decides that
        // means zero, in one place rather than at every call site.
        const value = raw === null || raw === undefined ? 0 : Number(raw);
        return { kind: "scalar", value: measureMayBeNull(request.analysis.measure) && raw === null ? 0 : value };
      }

      case "series": {
        const spec = this.spec(request);
        const rows = (await client.query(compileSeries(spec, request.axis, params), [...params.all])).rows;
        return {
          kind: "series",
          values: TimeAxis.densify(
            request.axis,
            rows.map((r) => ({ index: Number(r.bucket_ix), value: Number(r.value ?? 0) })),
          ),
        };
      }

      case "breakdown": {
        const dimension = breakdownDimension(request.analysis);
        if (dimension === null) {
          throw Object.assign(new Error("breakdown request has no field dimension"), { code: "22000" });
        }
        const spec = this.spec(request);
        const limit = request.analysis.limit ?? DEFAULT_BREAKDOWN_LIMIT;
        const rows = (await client.query(compileBreakdown(spec, dimension, limit, params), [...params.all])).rows;
        return {
          kind: "breakdown",
          rows: rows.map((r) => ({ label: String(r.label), value: Number(r.value ?? 0) })),
        };
      }

      case "sequence": {
        const funnel: Funnel = request.funnel;
        const sql = compileSequence(
          { project: request.project, funnel, from: Instant.toDate(request.bounds.from), to: Instant.toDate(request.bounds.to) },
          params,
        );
        const rows = (await client.query(sql, [...params.all])).rows;
        return {
          kind: "sequence",
          counts: readSequenceRow((rows[0] ?? {}) as Record<string, unknown>, funnel.steps.length),
        };
      }

      case "cohorts": {
        const retention: Retention = request.retention;
        const axis = TimeAxis.build(retention.window, retention.grain, request.bounds.to);
        const sql = compileCohorts(
          { project: request.project, retention, from: Instant.toDate(request.bounds.from), to: Instant.toDate(request.bounds.to) },
          axis,
          params,
        );
        const rows = (await client.query(sql, [...params.all])).rows as CohortRow[];
        const { sizes, observations } = readCohortRows(rows, axis);
        return { kind: "cohorts", sizes, observations };
      }
    }
  }

  private spec(request: Extract<StoreRequest, { analysis: Analysis }>) {
    return {
      project: request.project,
      analysis: request.analysis,
      from: Instant.toDate(request.bounds.from),
      to: Instant.toDate(request.bounds.to),
    };
  }
}
