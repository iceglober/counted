/**
 * Running a set of questions as one batch.
 *
 * This is the fan-out fix. v1 rendered a dashboard by looping over its
 * insights and awaiting each query in turn — 24 round trips for a 24-tile
 * board, serialised, against a pool of 20 shared with ingestion. Here every
 * tile's question is planned, the whole set goes to the store in one call, and
 * the answers are assembled independently.
 *
 * The other half of that bug was `Promise.allSettled` plus `emptyData()`: any
 * rejection became a blank chart indistinguishable from a project with no
 * events. `Outcome` has no zero value, so a failure cannot decay into an empty
 * result here — it becomes a `Readout` that says what went wrong, and the
 * client renders that rather than a lie.
 *
 * One tile failing does not fail the others. A dashboard with one broken tile
 * is a dashboard with one broken tile.
 */

import {
  Readout,
  type Instant,
  type ProjectId,
  type Result,
  type TileId,
} from "@counted/domain";
import { RequestId, type AnalyticalStore, type StoreRequest } from "@counted/ports";
import { assemble, failureFrom, failureFromAssemble } from "./assemble";
import { explainPlanError, planQuestion, type Plan, type PlanError, type Question } from "./plan";

/** One thing to answer: a tile, or a single ad-hoc query. */
export type Ask = {
  /** Identifies the answer in the response. A tile id, or a synthetic one. */
  readonly id: TileId;
  readonly project: ProjectId;
  readonly question: Question;
};

export type RunOptions = {
  readonly now: Instant;
  /** Hard ceiling for the whole batch, shared by every question in it. */
  readonly deadlineMs: number;
  readonly traceId: string;
};

export type Answers = {
  readonly readouts: readonly Readout[];
  /** How many statements the store actually ran. Asserted by tests. */
  readonly statements: number;
};

/**
 * Plan every ask, execute the plannable ones in one batch, assemble each.
 *
 * A question that cannot be planned never reaches the store and comes back as
 * a failed readout — a malformed tile must not stop the other twenty-three
 * being answered.
 */
export const runQuestions = async (
  store: AnalyticalStore,
  asks: readonly Ask[],
  options: RunOptions,
): Promise<Answers> => {
  const planned = new Map<TileId, Plan>();
  const failed: Readout[] = [];
  const requests: StoreRequest[] = [];

  asks.forEach((ask, index) => {
    // The request id is positional and local to this batch; the tile id is
    // what the caller gets back. Keeping them separate means two tiles asking
    // the identical question still get their own answers.
    const id = RequestId(`q${index}`);
    const plan: Result<Plan, PlanError> = planQuestion(id, ask.project, ask.question, options.now);
    if (!plan.ok) {
      failed.push(
        Readout.failed(ask.id, {
          code: "unsupported",
          detail: explainPlanError(plan.error),
          retriable: false,
        }),
      );
      return;
    }
    planned.set(ask.id, plan.value);
    requests.push(plan.value.request);
  });

  if (requests.length === 0) return { readouts: failed, statements: 0 };

  const batch = await store.executeBatch(requests, {
    deadlineMs: options.deadlineMs,
    traceId: options.traceId,
  });

  const answered: Readout[] = [];
  for (const [tile, plan] of planned) {
    const outcome = batch.results.get(plan.request.id);
    if (outcome === undefined) {
      // The store must answer every request it was given. If it did not, say
      // so — do not quietly render a blank.
      answered.push(
        Readout.failed(tile, {
          code: "store_unavailable",
          detail: "The store returned no answer for this question.",
          retriable: true,
        }),
      );
      continue;
    }

    if (!outcome.ok) {
      answered.push(Readout.failed(tile, failureFrom(outcome.error)));
      continue;
    }

    const value = assemble(plan, outcome.value);
    answered.push(
      value.ok
        ? Readout.answered(tile, value.value, outcome.computedAt)
        : Readout.failed(tile, failureFromAssemble(value.error)),
    );
  }

  // Back in the order the caller asked, so a dashboard renders its tiles in
  // its own order rather than in whichever order the store answered.
  const byTile = new Map<TileId, Readout>();
  for (const readout of [...failed, ...answered]) byTile.set(readout.tile, readout);

  return {
    readouts: asks.map((a) => byTile.get(a.id)).filter((r): r is Readout => r !== undefined),
    statements: batch.stats.statements,
  };
};
