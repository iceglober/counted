/**
 * Running every tile on a dashboard.
 *
 * **One outcome per tile, carried in a 200 body.** Eleven tiles with answers
 * and a twelfth saying "the engine timed out" is a usable page; a 504 for the
 * whole dashboard is not. The single-question route does the opposite, because
 * there the failed question is the only one there was.
 *
 * Two things this must never do, both of which v1 did.
 *
 * It must not invent an empty answer. Every failure below is a stated failure
 * with a reason; there is no `catch` that yields an empty series. v1 wrapped
 * its dashboard fan-out in `Promise.allSettled` and mapped every rejection to
 * `emptyData()`, so a broken query and a quiet project drew the same flat line.
 *
 * It must not resolve "now" per tile. The clock is read once for the request
 * and the same instant reaches every question, so two cards on one screen
 * cannot cover different intervals.
 */

import { Instant, unbrand, type ProjectId } from "@counted/kernel";
import { Analysis, type ProjectSchema, type Window } from "@counted/analytics-domain";
import type { Dashboard, Tile } from "@counted/dashboarding-domain";
import { Duration } from "@counted/kernel";
import { ask, readProjectSchema, type Answer, type AskDeps } from "../analysis/ask";
import type { A, ApiDependencies } from "../deps";

export type WireReadout =
  | {
      ok: true;
      id: string;
      tile?: string;
      value: Extract<Answer, { ok: true }>["value"];
      computedAt: string;
    }
  | { ok: false; id: string; tile?: string; failure: WireReadoutFailure };

export type WireReadoutFailure =
  | { kind: "Timeout"; budgetMs: number }
  | { kind: "Unavailable"; detail: string }
  | { kind: "InvalidQuery"; detail: string }
  | { kind: "NotImplemented"; feature: "retention" | "group_by" | "nested_predicates" };

/**
 * The engine's failure vocabulary, on the wire, one for one.
 *
 * `@counted/dashboarding-app`'s `toReadoutFailure` produces a different shape —
 * `{ code, detail, retriable }` — which the contract cannot carry: it has no
 * field for the timeout's budget or the missing capability's name. So the
 * mapping happens here, against the contract, and nothing is lost. Flagged in
 * the hand-off: the two vocabularies should become one.
 */
export const toWireFailure = (failure: Extract<Answer, { ok: false }>["failure"]): WireReadoutFailure => {
  switch (failure.kind) {
    case "Timeout":
      return { kind: "Timeout", budgetMs: Duration.toMillis(failure.budget) };
    case "Unavailable":
      return { kind: "Unavailable", detail: failure.detail };
    case "InvalidQuery":
      return { kind: "InvalidQuery", detail: failure.detail };
    case "NotImplemented":
      return { kind: "NotImplemented", feature: failure.feature };
  }
};

export type ReadoutRequest = {
  readonly dashboard: Dashboard<A>;
  /** Rebases every tile's question. This is how a range picker works without a
   *  tile storing a second copy of what it asks. */
  readonly window: Window | null;
  readonly deadline: Duration;
  readonly now: Instant;
  readonly traceId: string;
};

export const runDashboard = async (
  deps: ApiDependencies,
  request: ReadoutRequest,
): Promise<WireReadout[]> => {
  const askDeps: AskDeps = { engine: deps.engine, catalog: deps.catalog };

  // One schema read per distinct project, not per tile. A dashboard showing
  // eight tiles from one project would otherwise make eight identical catalog
  // round trips before asking a single question.
  const schemas = new Map<string, Promise<ProjectSchema>>();
  const schemaFor = (project: ProjectId): Promise<ProjectSchema> => {
    const key = unbrand(project);
    const existing = schemas.get(key);
    if (existing !== undefined) return existing;
    const loading = readProjectSchema(askDeps, project);
    schemas.set(key, loading);
    return loading;
  };

  return Promise.all(
    request.dashboard.tiles.map(async (tile: Tile<A>): Promise<WireReadout> => {
      const id = unbrand(tile.id);
      const analysis =
        request.window === null ? tile.analysis : Analysis.withWindow(tile.analysis, request.window);

      let answer: Answer;
      try {
        answer = await ask(
          askDeps,
          {
            project: tile.project,
            scope: { level: "project", project: tile.project },
            analysis,
            now: request.now,
            deadline: request.deadline,
            traceId: request.traceId,
          },
          await schemaFor(tile.project),
        );
      } catch (cause) {
        // An adapter that throws instead of returning an outcome is a broken
        // adapter, not a reason to fail eleven working tiles. The tile says so
        // rather than showing a blank.
        answer = {
          ok: false,
          failure: {
            kind: "Unavailable",
            detail: cause instanceof Error ? cause.message : String(cause),
          },
        };
      }

      return answer.ok
        ? { ok: true, id, tile: id, value: answer.value, computedAt: Instant.toISO(answer.computedAt) }
        : { ok: false, id, tile: id, failure: toWireFailure(answer.failure) };
    }),
  );
};
