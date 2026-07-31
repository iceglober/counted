/**
 * Reading: `POST /v1/query` and `POST /v1/dashboards/:dashboardId/data`.
 *
 * Both go through the same planner, the same store call and the same
 * assembler. A dashboard is a set of questions asked at once; a query is one
 * question. v1 had two separate code paths and they drifted — the dashboard
 * loader grew a bucketing implementation the ad-hoc path did not have.
 *
 * Every response is tagged with its shape. The client never infers which of
 * five things it received.
 */

import {
  Analysis,
  Dimension,
  Duration,
  FunnelStep,
  Instant,
  Measure,
  DashboardId,
  TileId,
  Window,
  type Funnel,
  type Grain,
  type Predicate,
  type Principal,
  type ProjectId,
  type Readout,
  type ReadoutValue,
  type Retention,
  type TileContent,
} from "@counted/domain";
import { runQuestions, type Ask, type Question } from "@counted/application";
import {
  QueryRequestSchema,
  fieldsFrom,
  validationDetail,
  z,
  type FunnelSchema,
  type QuestionSchema,
  type RetentionSchema,
} from "@counted/contracts";
import type { Dependencies } from "../composition";
import { dashboardFromPath, projectFromPath, requires, type RouteDefinition } from "../http/route";
import { sendProblem } from "../http/respond";

/** A query's budget. Past this the answer is a timeout, not a hung request. */
const QUERY_DEADLINE_MS = 10_000;

/** One dashboard, one batch — so this is the whole board's budget too. */
const DASHBOARD_DEADLINE_MS = 20_000;

// ── Wire to domain ───────────────────────────────────────────────────────────
//
// Written out rather than cast. The wire speaks ISO strings and milliseconds;
// the domain speaks `Instant` and `Duration`. An `as` between them compiles and
// is wrong — that exact shortcut on the ingest path made every first-time
// event look like a duplicate and disabled the clock-skew checks entirely.

type WireWindow =
  | { kind: "relative"; amount: number; unit: "hour" | "day" | "week" | "month" }
  | { kind: "absolute"; from: string; to: string };

const RELATIVE: Record<"hour" | "day" | "week" | "month", (n: number) => Window> = {
  hour: Window.lastHours,
  day: Window.lastDays,
  week: Window.lastWeeks,
  month: Window.lastMonths,
};

const toWindow = (w: WireWindow): Window =>
  w.kind === "relative"
    ? RELATIVE[w.unit](w.amount)
    : Window.between(Instant.fromDate(new Date(w.from)), Instant.fromDate(new Date(w.to)));

const toFunnel = (f: z.infer<typeof FunnelSchema>): Funnel => ({
  steps: f.steps.map((s) => FunnelStep.of(s.events, s.where as Predicate | undefined, s.label)),
  window: toWindow(f.window as WireWindow),
  conversionWindow: Duration.millis(f.conversionWindowMs),
  basis: f.basis ?? "visit",
  ...(f.where === undefined ? {} : { where: f.where as Predicate }),
});

const toRetention = (r: z.infer<typeof RetentionSchema>): Retention => ({
  window: toWindow(r.window as WireWindow),
  grain: r.grain as Grain,
  periods: r.periods,
  // The schema admits nothing else, and neither does the domain type.
  basis: "person",
  ...(r.startEvents === undefined ? {} : { startEvents: r.startEvents }),
  ...(r.returnEvents === undefined ? {} : { returnEvents: r.returnEvents }),
  ...(r.where === undefined ? {} : { where: r.where as Predicate }),
});

const toAnalysis = (a: z.infer<typeof QuestionSchema> & { kind: "analysis" }): Analysis => {
  const wire = a.analysis;
  return {
    measure: wire.measure as Measure,
    window: toWindow(wire.window as WireWindow),
    ...(wire.events === undefined ? {} : { events: wire.events }),
    ...(wire.where === undefined ? {} : { where: wire.where as Predicate }),
    ...(wire.groupBy === undefined
      ? {}
      : {
          groupBy: wire.groupBy.map((d) =>
            d.by === "time" ? Dimension.time(d.grain as Grain) : Dimension.field(d.field),
          ),
        }),
    ...(wire.orderBy === undefined ? {} : { orderBy: wire.orderBy }),
    ...(wire.limit === undefined ? {} : { limit: wire.limit }),
  };
};

const toQuestion = (q: z.infer<typeof QuestionSchema>): Question => {
  switch (q.kind) {
    case "analysis":
      return { kind: "analysis", analysis: toAnalysis(q) };
    case "funnel":
      return { kind: "funnel", funnel: toFunnel(q.funnel) };
    case "retention":
      return { kind: "retention", retention: toRetention(q.retention) };
  }
};

// ── Domain to wire ───────────────────────────────────────────────────────────

const readoutValueToWire = (value: ReadoutValue): unknown => {
  switch (value.shape) {
    case "scalar":
      return { shape: "scalar", value: value.value };
    case "series":
      return {
        shape: "series",
        points: value.points.map((p) => ({ bucketStart: Instant.toISO(p.bucketStart), value: p.value })),
      };
    case "breakdown":
      return { shape: "breakdown", rows: value.rows };
    case "funnel":
      return {
        shape: "funnel",
        steps: value.result.steps,
        overallRate: value.result.overallRate,
      };
    case "retention":
      return {
        shape: "retention",
        offsets: value.grid.offsets,
        cohorts: value.grid.cohorts.map((c) => ({
          start: Instant.toISO(c.start),
          size: c.size,
          // `null` where the period has not begun — distinct from a real zero,
          // which means it has begun and nobody came back. v1 conflated them.
          cells: c.cells,
        })),
      };
  }
};

const readoutToWire = (readout: Readout): unknown =>
  readout.ok
    ? {
        id: String(readout.tile),
        ok: true,
        value: readoutValueToWire(readout.value),
        computedAt: Instant.toISO(readout.computedAt),
      }
    : { id: String(readout.tile), ok: false, failure: readout.failure };

/** HTTP status for a readout that failed. A timeout is not a 500. */
const statusFor = (readout: Extract<Readout, { ok: false }>) => {
  switch (readout.failure.code) {
    case "timeout":
      return "query.timeout" as const;
    case "unsupported":
      return "query.unsupported" as const;
    case "invalid_request":
      return "request.validation_failed" as const;
    case "store_unavailable":
      return "internal.unavailable" as const;
  }
};

export const queryRoutes = (deps: Dependencies): readonly RouteDefinition[] => [
  {
    method: "post",
    path: "/v1/projects/:projectId/query",
    security: requires("queries:run", projectFromPath()),
    handler: async (c) => {
      const log = c.get("log");
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return sendProblem(c, "request.malformed", { detail: "The body is not valid JSON." });
      }

      const parsed = QueryRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const fields = fieldsFrom(parsed.error);
        return sendProblem(c, "request.validation_failed", { detail: validationDetail(fields), fields });
      }

      const project = c.req.param("projectId") as ProjectId;
      const ask: Ask = {
        id: TileId("query"),
        project,
        question: toQuestion(parsed.data.question),
      };

      const { readouts, statements } = await runQuestions(deps.store, [ask], {
        now: deps.clock.now(),
        deadlineMs: QUERY_DEADLINE_MS,
        traceId: c.get("trace").traceId,
      });

      const readout = readouts[0];
      if (readout === undefined) {
        return sendProblem(c, "internal.error", { detail: "The query produced no answer." });
      }

      if (!readout.ok) {
        // A single query's failure is the request's failure — there is nothing
        // else in the response for it to sit beside.
        log.warn("query.failed", { projectId: project, code: readout.failure.code, statements });
        return sendProblem(c, statusFor(readout), { detail: readout.failure.detail });
      }

      log.info("query.answered", { projectId: project, shape: readout.value.shape, statements });
      return c.json({
        value: readoutValueToWire(readout.value),
        computedAt: Instant.toISO(readout.computedAt),
      });
    },
  },
  {
    method: "post",
    path: "/v1/dashboards/:dashboardId/data",
    security: requires("dashboards:read", dashboardFromPath()),
    handler: async (c) => {
      const log = c.get("log");
      const dashboardId = c.req.param("dashboardId")!;

      const dashboard = await deps.unitOfWork.transact((repos) =>
        repos.dashboards.find(DashboardId(dashboardId)),
      );
      if (dashboard === null) return sendProblem(c, "resource.not_found");

      const principal: Principal = c.get("principal");
      const tiles = dashboard.tiles;

      // A share link may render only the dashboard it was issued for, and only
      // the projects that dashboard's own tiles read. Enforced by the guard
      // against the dashboard; the tiles cannot widen it, because they are the
      // thing that defined it.
      const asks: readonly Ask[] = tiles.map((tile) => ({
        id: tile.id,
        project: tile.project,
        question: questionFromTile(tile.content),
      }));

      const { readouts, statements } = await runQuestions(deps.store, asks, {
        now: deps.clock.now(),
        deadlineMs: DASHBOARD_DEADLINE_MS,
        traceId: c.get("trace").traceId,
      });

      // One line per dashboard render, carrying the number that matters.
      log.info("dashboard.rendered", {
        dashboardId,
        tiles: tiles.length,
        failed: readouts.filter((r) => !r.ok).length,
        statements,
        principalKind: principal.kind,
      });

      return c.json({
        readouts: readouts.map(readoutToWire),
        statements,
        computedAt: Instant.toISO(deps.clock.now()),
      });
    },
  },
];

/** A tile's content is already the question. No translation, by design. */
const questionFromTile = (content: TileContent): Question => {
  switch (content.kind) {
    case "analysis":
      return { kind: "analysis", analysis: content.analysis };
    case "funnel":
      return { kind: "funnel", funnel: content.funnel };
    case "retention":
      return { kind: "retention", retention: content.retention };
  }
};
