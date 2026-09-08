/**
 * `MonitorRepository` over Postgres.
 *
 * Everything v1 stored as text and reparsed on every evaluation is a typed
 * column here, and each one was a live defect:
 *
 *   - the threshold was `text` recovered with `parseFloat`, so a value that
 *     failed to parse compared as `NaN` and the monitor silently never fired;
 *   - the window was a string matched against `/^(\d+)(h|d)$/`, so a monitor
 *     configured for `"1w"` fell through to one hour and measured something
 *     nobody asked for;
 *   - the metric was free text with its own hand-rolled compiler that
 *     understood three shapes, while the same question on a dashboard tile went
 *     through the full analysis.
 *
 * So: `threshold_value` is `double precision`, `cooldown_ms` is a `bigint` with
 * a non-negative CHECK, and `analysis` is the same `jsonb` a tile stores — one
 * definition, two consumers, which is the claim this table has to make true.
 */

import { Duration, Instant, MonitorId, ProjectId, WorkspaceId } from "@counted/kernel";
import {
  Monitor,
  alertsFor,
  type MonitorAlert,
  Threshold,
  type Channel,
  type MonitorEvent,
  type MonitorState,
} from "@counted/dashboarding-domain";
import type { MonitorDelivery, MonitorRepository } from "@counted/dashboarding-ports";
import {
  RowDecodeError,
  decodeText,
  millisOf,
  optionalInstant,
  optionalTimestamp,
  type AnalysisCodec,
  type Column,
} from "./decode";
import { exec, firstRow, rows, type Queryable } from "./queryable";

type MonitorRow = {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly name: string;
  readonly analysis: unknown;
  readonly threshold_comparison: string;
  readonly threshold_value: number;
  readonly cooldown_ms: string;
  readonly channels: unknown;
  readonly enabled: boolean;
  readonly state: string;
  readonly last_notified_at: Date | null;
  readonly last_value: number | null;
  readonly last_attempt_at: Date | null;
  readonly last_measured_at: Date | null;
  readonly evaluation_error: string | null;
  readonly pending_deliveries: string;
  readonly failed_deliveries: string;
  readonly delivery_error: string | null;
  readonly last_delivered_at: Date | null;
};

const SELECT = `SELECT id, workspace_id, project_id, name, analysis, threshold_comparison,
                       threshold_value, cooldown_ms, channels, enabled, state,
                       last_notified_at, last_value, last_attempt_at, last_measured_at, evaluation_error,
                       (SELECT count(*) FROM monitor_deliveries d WHERE d.monitor_id = monitors.id AND d.delivered_at IS NULL AND d.canceled_at IS NULL) AS pending_deliveries,
                       (SELECT count(*) FROM monitor_deliveries d WHERE d.monitor_id = monitors.id AND d.delivered_at IS NULL AND d.canceled_at IS NULL AND d.last_error IS NOT NULL) AS failed_deliveries,
                       (SELECT d.last_error FROM monitor_deliveries d WHERE d.monitor_id = monitors.id AND d.delivered_at IS NULL AND d.canceled_at IS NULL AND d.last_error IS NOT NULL ORDER BY d.occurred_at DESC, d.id LIMIT 1) AS delivery_error,
                       (SELECT max(d.delivered_at) FROM monitor_deliveries d WHERE d.monitor_id = monitors.id) AS last_delivered_at
                FROM monitors`;

const isComparison = (value: string): value is Threshold["comparison"] =>
  value === "above" || value === "below";

const isMonitorState = (value: string): value is MonitorState =>
  value === "ok" || value === "breaching";

export class PostgresMonitorRepository<A> implements MonitorRepository<Monitor<A>, MonitorEvent> {
  constructor(
    private readonly db: Queryable,
    private readonly analysis: AnalysisCodec<A>,
  ) {}

  async find(id: MonitorId): Promise<Monitor<A> | null> {
    const row = await firstRow<MonitorRow>(this.db, `${SELECT} WHERE id = $1`, [id]);
    return row === null ? null : this.rehydrate(row);
  }

  async listForProject(project: ProjectId): Promise<readonly Monitor<A>[]> {
    return this.many(`${SELECT} WHERE project_id = $1 ORDER BY name, id`, [project]);
  }

  async listForWorkspace(workspace: WorkspaceId): Promise<readonly Monitor<A>[]> {
    return this.many(`${SELECT} WHERE workspace_id = $1 ORDER BY name, id`, [workspace]);
  }

  /** Reads are fair even for monitors that have never breached. */
  async listEnabled(limit: number): Promise<readonly Monitor<A>[]> {
    return this.many(`${SELECT} WHERE enabled ORDER BY last_attempt_at NULLS FIRST, id LIMIT $1`, [limit]);
  }

  async claimEnabled(limit: number, at: Instant, exclude: readonly MonitorId[] = []): Promise<readonly Monitor<A>[]> {
    // Lease the whole batch atomically. Advancing the attempt before querying also
    // makes a broken monitor yield its place, including after a worker crash.
    const claimed = await this.many(`WITH due AS (
      SELECT id FROM monitors WHERE enabled AND NOT (id = ANY($3::text[]))
        AND (evaluation_claimed_until IS NULL OR evaluation_claimed_until <= $2)
      ORDER BY last_attempt_at NULLS FIRST, id LIMIT $1 FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE monitors m SET last_attempt_at = $2,
        evaluation_claimed_until = $2::timestamptz + interval '10 minutes'
      FROM due WHERE m.id = due.id RETURNING m.id
    ) ${SELECT} WHERE id IN (SELECT id FROM claimed) ORDER BY last_attempt_at NULLS FIRST, id`,
    [limit, Instant.toISO(at), exclude]);
    return claimed.map((monitor) => Monitor.rehydrate({ ...monitor.snapshot(), lastAttemptAt: at, evaluationClaim: at }));
  }

  /** State and every recipient's immutable alert commit in one SQL statement. */
  async save(monitor: Monitor<A>, events: readonly MonitorEvent[]): Promise<void> {
    const s = monitor.snapshot();
    await exec(
      this.db,
      `WITH saved AS (INSERT INTO monitors
         (id, workspace_id, project_id, name, analysis, threshold_comparison, threshold_value,
          cooldown_ms, channels, enabled, state, last_notified_at, last_value,
          last_attempt_at, last_measured_at, evaluation_error)
       SELECT $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16
       WHERE $18::timestamptz IS NULL OR EXISTS (SELECT 1 FROM monitors WHERE id = $1)
       ON CONFLICT (id) DO UPDATE
         SET workspace_id = EXCLUDED.workspace_id,
             project_id = EXCLUDED.project_id,
             name = EXCLUDED.name,
             analysis = EXCLUDED.analysis,
             threshold_comparison = EXCLUDED.threshold_comparison,
             threshold_value = EXCLUDED.threshold_value,
             cooldown_ms = EXCLUDED.cooldown_ms,
             channels = EXCLUDED.channels,
             enabled = EXCLUDED.enabled,
             state = EXCLUDED.state,
             last_notified_at = EXCLUDED.last_notified_at,
             last_value = EXCLUDED.last_value,
             last_attempt_at = EXCLUDED.last_attempt_at,
             last_measured_at = EXCLUDED.last_measured_at,
             evaluation_error = EXCLUDED.evaluation_error,
             evaluation_claimed_until = NULL,
             updated_at = now()
       WHERE $18::timestamptz IS NULL OR (monitors.last_attempt_at = $18 AND monitors.evaluation_claimed_until IS NOT NULL)
       RETURNING id), canceled AS (
         UPDATE monitor_deliveries SET canceled_at = now(), claimed_at = NULL
         WHERE monitor_id IN (SELECT id FROM saved)
           AND ($19::boolean OR ($20::boolean AND NOT ($9::jsonb @> jsonb_build_array(alert->'channel'))))
           AND delivered_at IS NULL AND canceled_at IS NULL
       )
       INSERT INTO monitor_deliveries (id, monitor_id, alert, occurred_at, next_attempt_at)
       SELECT item->>'id', saved.id, item, (item->>'occurredAt')::timestamptz, (item->>'occurredAt')::timestamptz
       FROM saved CROSS JOIN jsonb_array_elements($17::jsonb) item
       ON CONFLICT (id) DO NOTHING`,
      [
        s.id,
        s.workspace,
        s.project,
        s.name,
        JSON.stringify(this.analysis.encode(s.analysis)),
        s.threshold.comparison,
        s.threshold.value,
        String(Duration.toMillis(s.cooldown)),
        JSON.stringify(s.channels),
        s.enabled,
        s.state,
        optionalTimestamp(s.lastNotifiedAt),
        s.lastValue,
        optionalTimestamp(s.lastAttemptAt),
        optionalTimestamp(s.lastMeasuredAt),
        s.evaluationError,
        JSON.stringify(events.flatMap((event) => alertsFor(monitor, event))),
        optionalTimestamp(s.evaluationClaim ?? null),
        events.some((event) => event.kind === "MonitorRetargeted" || event.kind === "MonitorDisabled"),
        events.some((event) => event.kind === "MonitorReconfigured"),
      ],
    );
  }

  async claimDeliveries(limit: number, at: Instant): Promise<readonly MonitorDelivery[]> {
    const found = await rows<{ alert: MonitorAlert; attempts: number; claimed_at: Date }>(this.db, `
      WITH due AS (
        SELECT d.id FROM monitor_deliveries d
        WHERE d.delivered_at IS NULL AND d.canceled_at IS NULL AND d.next_attempt_at <= $2
          AND (d.claimed_at IS NULL OR d.claimed_at <= $2::timestamptz - interval '5 minutes')
          AND NOT EXISTS (
            SELECT 1 FROM monitor_deliveries prior
            WHERE prior.monitor_id = d.monitor_id AND prior.delivered_at IS NULL AND prior.canceled_at IS NULL
              AND prior.alert->'channel' = d.alert->'channel'
              AND (prior.occurred_at, prior.id) < (d.occurred_at, d.id)
          )
        ORDER BY d.next_attempt_at, d.occurred_at, d.id LIMIT $1 FOR UPDATE SKIP LOCKED
      ) UPDATE monitor_deliveries d SET claimed_at = $2, attempts = attempts + 1
        FROM due WHERE due.id = d.id RETURNING d.alert, d.attempts, d.claimed_at`,
      [limit, Instant.toISO(at)]);
    return found.map((row) => ({ alert: row.alert, attempts: row.attempts,
      claimedAt: Instant.fromEpochMillis(row.claimed_at.getTime()) }));
  }

  async completeDelivery(delivery: MonitorDelivery, at: Instant): Promise<void> {
    await exec(this.db, `UPDATE monitor_deliveries SET delivered_at = $3, last_error = NULL, claimed_at = NULL
      WHERE id = $1 AND claimed_at = $2 AND delivered_at IS NULL AND canceled_at IS NULL`,
      [delivery.alert.id, Instant.toISO(delivery.claimedAt), Instant.toISO(at)]);
  }

  async failDelivery(delivery: MonitorDelivery, error: string, at: Instant): Promise<void> {
    const backoffMs = Math.min(3_600_000, 30_000 * 2 ** Math.min(delivery.attempts - 1, 7));
    await exec(this.db, `UPDATE monitor_deliveries SET last_error = $3, claimed_at = NULL, next_attempt_at = $4
      WHERE id = $1 AND claimed_at = $2 AND delivered_at IS NULL AND canceled_at IS NULL`,
      [delivery.alert.id, Instant.toISO(delivery.claimedAt), error.slice(0, 2000),
       Instant.toISO(Instant.plus(at, Duration.millis(backoffMs)))]);
  }

  async delete(id: MonitorId): Promise<void> {
    await exec(this.db, `DELETE FROM monitors WHERE id = $1`, [id]);
  }

  private async many(text: string, values: unknown[]): Promise<readonly Monitor<A>[]> {
    const found = await rows<MonitorRow>(this.db, text, values);
    return found.map((row) => this.rehydrate(row));
  }

  private rehydrate(row: MonitorRow): Monitor<A> {
    const where = { table: "monitors", id: row.id };
    const comparison = decodeText(row.threshold_comparison, isComparison, {
      ...where,
      column: "threshold_comparison",
    });
    return Monitor.rehydrate<A>({
      id: MonitorId(row.id),
      workspace: WorkspaceId(row.workspace_id),
      project: ProjectId(row.project_id),
      name: row.name,
      analysis: this.analysis.decode(row.analysis),
      threshold:
        comparison === "above"
          ? Threshold.above(row.threshold_value)
          : Threshold.below(row.threshold_value),
      cooldown: Duration.millis(millisOf(row.cooldown_ms, { ...where, column: "cooldown_ms" })),
      channels: channelsOf(row.channels, { ...where, column: "channels" }),
      enabled: row.enabled,
      state: decodeText<MonitorState>(row.state, isMonitorState, { ...where, column: "state" }),
      lastNotifiedAt: optionalInstant(row.last_notified_at),
      lastValue: row.last_value,
      lastAttemptAt: optionalInstant(row.last_attempt_at),
      lastMeasuredAt: optionalInstant(row.last_measured_at),
      evaluationError: row.evaluation_error,
      pendingDeliveries: Number(row.pending_deliveries),
      failedDeliveries: Number(row.failed_deliveries),
      deliveryError: row.delivery_error,
      lastDeliveredAt: optionalInstant(row.last_delivered_at),
    });
  }
}

/**
 * Channels are the one column stored as free-form JSON, so they are the one
 * that has to be checked on the way out. A monitor whose webhook url decoded to
 * `undefined` would fire, fail to deliver, and report itself as having fired.
 */
const channelsOf = (raw: unknown, where: Column): readonly Channel[] => {
  if (!Array.isArray(raw)) throw new RowDecodeError(where.table, where.id, where.column, raw);
  return raw.map((entry) => {
    if (typeof entry === "object" && entry !== null) {
      const candidate = entry as { kind?: unknown; address?: unknown; url?: unknown };
      if (candidate.kind === "email" && typeof candidate.address === "string") {
        return { kind: "email", address: candidate.address };
      }
      if (candidate.kind === "webhook" && typeof candidate.url === "string") {
        return { kind: "webhook", url: candidate.url };
      }
    }
    throw new RowDecodeError(where.table, where.id, where.column, entry);
  });
};
