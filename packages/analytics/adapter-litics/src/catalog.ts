/**
 * `SchemaCatalog` over the litics dictionary, summaries and staging.
 *
 * v1 answered "what event names does this project have?" by scanning the
 * project's whole history on every configurator open. Under litics the answer
 * is nearly materialised: dimension values are dictionary-encoded in
 * `analytics.dims`, and the summary rows carry which encoded ids a tenant has
 * actually produced, one row per (segment, hour, event type, dimensions).
 * Anything written in the last few seconds is still in staging, so both are
 * read: the summary for everything packed, staging for the tail.
 *
 * This is the one file that writes SQL by hand rather than taking it from
 * litics, because litics has no catalog builder. Two rules keep that safe: the
 * only interpolated identifier is a dimension column checked against the
 * config's own declared list, and every value is a bound parameter.
 *
 * **The port has no failure channel, so a failure throws.** `eventNames`
 * returns `Promise<readonly string[]>`; there is no outcome to put an error in.
 * Returning `[]` on a broken query would render a configurator that says the
 * project has no events, which is a lie about the data rather than a report
 * about the system. The caller sees the exception.
 */

import { decode } from "@litics/core";
import { segmentOf } from "./raw";
import type { EngineFailure, SchemaCatalog } from "@counted/analytics-ports";
import { assertNever, Duration, Instant, unbrand, type ProjectId } from "@counted/kernel";
import type { Clock } from "@counted/kernel/ports";

import {
  resolvedStream, segmentsTable,
  INDEXED_DIMENSIONS,
  DECLARED_MEASURES,
  dictionaryKey,
  dimensionOrdinal,
  dimsTable,
  orgTreeTable,
  stagingTable,
  summaryDimsTable,
  summaryTable,
} from "./config";
import { execute, type QueryPool, type Row } from "./execute";

/**
 * How far back the catalog looks.
 *
 * Not "all history". A dimension value nobody has produced in three months is
 * not a useful suggestion in a filter picker, and unbounded means every
 * summary row of 760 days.
 */
export const CATALOG_LOOKBACK = Duration.days(90);

/** A catalog read is a picker populating; it does not get a page's budget. */
export const CATALOG_DEADLINE = Duration.seconds(5);

/** Hard ceiling on `dimensionValues`. It is a picker's list, not a breakdown's
 * plan any more — but `device_model` grows with every customer's device mix,
 * and an uncapped read of the dictionary is a scan for a menu nobody scrolls. */
export const MAX_DIMENSION_VALUES = 1000;

export type LiticsCatalogDeps = {
  readonly pool: QueryPool;
  readonly clock: Clock;
};

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, Math.floor(value)));

export class LiticsSchemaCatalog implements SchemaCatalog {
  readonly #pool: QueryPool;
  readonly #clock: Clock;

  constructor(deps: LiticsCatalogDeps) {
    this.#pool = deps.pool;
    this.#clock = deps.clock;
  }

  /**
   * Event names this project has actually produced.
   *
   * The summary's index leads with `(tenant_id, bucket)`, so this is a range
   * scan over one tenant's rows, plus the same over staging's `(tenant_id, ts)`
   * for whatever has not been packed yet.
   */
  async eventNames(project: ProjectId): Promise<readonly string[]> {
    const rows = await this.#run(
      `SELECT d.value AS value
         FROM (SELECT s.event_type
                 FROM ${summaryTable()} s
                WHERE s.tenant_id IN (SELECT descendant FROM ${orgTreeTable()} WHERE ancestor = $1::text)
                  AND s.bucket >= $2::timestamptz
                UNION
               SELECT e.event_type
                 FROM ${stagingTable()} e
                WHERE e.tenant_id IN (SELECT descendant FROM ${orgTreeTable()} WHERE ancestor = $1::text)
                  AND e.ts >= $2::timestamptz) t
         JOIN ${dimsTable()} d ON d.dim = $3 AND d.id = t.event_type
        ORDER BY d.value
        LIMIT $4`,
      [unbrand(project), this.#since(), dictionaryKey("event_type"), MAX_DIMENSION_VALUES],
    );
    return rows.map((row) => String(row["value"]));
  }

  /**
   * The dimensions the segments carry — read off the config, not the
   * database.
   *
   * They are the same thing by construction: the declared dimension list is
   * what generated the columns. Querying for it would be asking the database
   * to confirm what this package already decided, and would answer
   * differently during a migration.
   */
  async dimensions(_project: ProjectId): Promise<readonly string[]> {
    return INDEXED_DIMENSIONS;
  }

  /** Suggestions from recent events; custom keys remain usable even outside this sample. */
  async properties(project: ProjectId): Promise<readonly string[]> {
    const result = await execute(this.#pool, [
      { sql: `SELECT e.props FROM ${stagingTable()} e WHERE e.tenant_id = $1::text AND e.ts >= $2::timestamptz ORDER BY e.ts DESC LIMIT 1000`, parameters: [unbrand(project), this.#since()] },
      { sql: `SELECT s.format, s.n, s.raw_bytes, s.props, (extract(epoch FROM s.ts_min)*1000000)::text AS ts_min_us, (extract(epoch FROM s.ts_max)*1000000)::text AS ts_max_us FROM ${segmentsTable()} s WHERE s.tenant_id = $1::text AND s.ts_max >= $2::timestamptz ORDER BY s.ts_max DESC LIMIT 8`, parameters: [unbrand(project), this.#since()] },
    ], {deadline: CATALOG_DEADLINE, traceId: "property-catalog"});
    if (!result.ok) throw new Error(`Property suggestions could not be read: ${describe(result.error)}`);
    const names = new Set<string>();
    const add = (raw: unknown) => {
      const props = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (props && typeof props === "object") for (const key of Object.keys(props)) if (!key.startsWith("$")) names.add(key);
    };
    for (const row of result.results[0] ?? []) add(row["props"]);
    for (const row of result.results[1] ?? []) for (const raw of decode(resolvedStream, segmentOf(row, ["props"]), ["props"]).props ?? []) add(raw);
    return [...names].sort();
  }


  /**
   * Distinct values for one dimension, most frequent first.
   *
   * Summary rows whose raw dimension was NULL carry the sentinel id 0, and
   * dictionary ids are `GENERATED ALWAYS AS IDENTITY` starting at 1 — so the
   * join drops them; staging rows with a NULL are filtered the same way. "No
   * value reported" never appears in a picker as a value someone can filter on.
   */
  async dimensionValues(
    project: ProjectId,
    dimension: string,
    limit: number,
  ): Promise<readonly string[]> {
    if (!INDEXED_DIMENSIONS.includes(dimension)) {
      // Also the injection guard: `dimension` is the only identifier this file
      // interpolates, and this is the list it must come from.
      throw new Error(
        `no segment column carries "${dimension}"; declared dimensions: ${INDEXED_DIMENSIONS.join(", ")}`,
      );
    }
    const capped = clamp(limit, 1, MAX_DIMENSION_VALUES);
    // `event_type` is a column of the base summary; every other dimension is
    // a (dim, value) pair in the marginal table.
    const packed =
      dimension === "event_type"
        ? `SELECT s.event_type AS id, s.n FROM ${summaryTable()} s
                WHERE s.tenant_id IN (SELECT descendant FROM ${orgTreeTable()} WHERE ancestor = $2::text)
                  AND s.bucket >= $3::timestamptz`
        : `SELECT s.value AS id, s.n FROM ${summaryDimsTable()} s
                WHERE s.tenant_id IN (SELECT descendant FROM ${orgTreeTable()} WHERE ancestor = $2::text)
                  AND s.dim = ${dimensionOrdinal(dimension)}
                  AND s.bucket >= $3::timestamptz`;
    const rows = await this.#run(
      `SELECT d.value AS value, sum(t.n)::float8 AS n
         FROM (${packed}
                UNION ALL
               SELECT e.${dimension} AS id, 1::bigint AS n
                 FROM ${stagingTable()} e
                WHERE e.tenant_id IN (SELECT descendant FROM ${orgTreeTable()} WHERE ancestor = $2::text)
                  AND e.ts >= $3::timestamptz
                  AND e.${dimension} IS NOT NULL) t
         JOIN ${dimsTable()} d ON d.dim = $1 AND d.id = t.id
        GROUP BY d.value
        ORDER BY n DESC, d.value ASC
        LIMIT $4`,
      [dictionaryKey(dimension), unbrand(project), this.#since(), capped],
    );
    return rows.map((row) => String(row["value"]));
  }

  /**
   * Declared numeric measures — none today.
   *
   * `config.ts` explains why: a measure is an additive fact on every event, and
   * Counted's SDKs send an open property bag rather than any declared number.
   * An empty list here is what makes `Analysis.check` refuse a `sum` analysis
   * with `UnknownMeasure` before it reaches the engine.
   */
  async measures(_project: ProjectId): Promise<readonly string[]> {
    return DECLARED_MEASURES;
  }

  #since(): string {
    return Instant.toISO(Instant.minus(this.#clock.now(), CATALOG_LOOKBACK));
  }

  async #run(sql: string, parameters: readonly unknown[]): Promise<readonly Row[]> {
    const outcome = await execute(this.#pool, [{ sql, parameters: [...parameters] }], {
      deadline: CATALOG_DEADLINE,
      traceId: "schema-catalog",
    });
    if (!outcome.ok) {
      throw new Error(`analytics catalog read failed: ${describe(outcome.error)}`);
    }
    return outcome.results[0] ?? [];
  }
}

/** Flatten a failure into one sentence, since the port can only carry a throw. */
const describe = (error: EngineFailure): string => {
  switch (error.kind) {
    case "Timeout":
      return `timed out after ${Duration.toMillis(error.budget)}ms`;
    case "Unavailable":
      return error.detail;
    case "InvalidQuery":
      return error.detail;
    case "NotImplemented":
      return `${error.feature} is not implemented`;
    default:
      return assertNever(error);
  }
};
