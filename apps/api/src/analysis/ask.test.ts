/**
 * The query planner: an Analysis in, engine calls out, an answer or a stated
 * reason there is none.
 *
 * The rule every test here defends is the one v1 broke: a failure must never
 * become a number. v1's dashboard loader wrapped its fan-out in
 * `Promise.allSettled` and mapped every rejection to `emptyData()`, so a broken
 * query and a genuinely quiet project drew the same flat line and a customer
 * could not tell "you have no traffic" from "we could not ask".
 */

import { describe, expect, test } from "bun:test";
import { Duration, Instant, type ProjectId } from "@counted/kernel";
import {
  Analysis,
  DimensionCatalog,
  FieldRef,
  Funnel,
  FunnelStep,
  Measure,
  Predicate,
  Window,
  type ProjectSchema,
} from "@counted/analytics-domain";
import type {
  AnalyticsEngine,
  Breakdown,
  BreakdownQuery,
  Bucket,
  EngineOutcome,
  SeriesQuery,
} from "@counted/analytics-ports";
import { ask, UNSET_LABEL, type AskDeps, type Question } from "./ask";
import { fixedCatalog, unavailableEngine } from "../testing";

const NOW = Instant.fromEpochMillis(Date.UTC(2026, 2, 15, 12, 0, 0));
const PROJECT = "pr_1" as ProjectId;

const schema: ProjectSchema = {
  dimensions: DimensionCatalog.of(
    ["event_type", "os_name", "locale"],
    ["country"],
  ),
  measures: ["revenue"],
};

const buckets = (...values: number[]): Bucket[] =>
  values.map((value, index) => ({
    start: Instant.plus(NOW, Duration.hours(index)),
    value,
  }));

const answering = (
  overrides: Partial<AnalyticsEngine>,
  seen: SeriesQuery[] = [],
): AnalyticsEngine =>
  unavailableEngine({
    counts: async (query) => {
      seen.push(query);
      return {
        ok: true,
        value: { buckets: buckets(1, 2, 3) },
        computedAt: NOW,
      };
    },
    ...overrides,
  });

const deps = (engine: AnalyticsEngine, catalog = fixedCatalog()): AskDeps => ({
  engine,
  catalog,
});

const question = (analysis: Analysis): Question => ({
  project: PROJECT,
  scope: { level: "project", project: PROJECT },
  analysis,
  now: NOW,
  deadline: Duration.seconds(5),
  traceId: "trace-1",
});

describe("a scalar analysis", () => {
  test("multiple selected events reach the engine together", async () => {
    const seen: SeriesQuery[] = [];
    const analysis = {
      ...Analysis.countOverWindow(Window.lastDays(7), "total"),
      where: Predicate.in(FieldRef.dimension("event_type"), ["view", "buy"]),
    };
    const answer = await ask(
      deps(answering({}, seen)),
      question(analysis),
      schema,
    );
    expect(answer.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.event).toEqual(["view", "buy"]);
  });
  /**
   * The series is summed, not sampled. "Visitors this week" is the week's
   * total; a card that showed only the most recent bucket while its label said
   * "this week" is the v1 metric-card bug — invisible, because the number it
   * draws is always plausible.
   */
  test("total sums the whole series rather than taking a bucket", async () => {
    const answer = await ask(
      deps(answering({})),
      question(Analysis.countOverWindow(Window.lastDays(7), "total")),
      schema,
    );
    expect(answer).toMatchObject({
      ok: true,
      value: { shape: "scalar", value: 6 },
    });
  });

  test("peak takes the largest bucket", async () => {
    const answer = await ask(
      deps(answering({})),
      question(Analysis.countOverWindow(Window.lastDays(7), "peak")),
      schema,
    );
    expect(answer).toMatchObject({
      ok: true,
      value: { shape: "scalar", value: 3 },
    });
  });

  /**
   * `SummaryStat.apply` returns null for every statistic but `total` on an
   * empty series, because the peak of nothing is not zero. A dense series is
   * never empty, so reaching that means the window produced no buckets — a bad
   * window, not a quiet project, and it must not answer 0.
   */
  test("a window with no buckets refuses rather than answering zero", async () => {
    const answer = await ask(
      deps(
        unavailableEngine({
          counts: async () => ({
            ok: true,
            value: { buckets: [] },
            computedAt: NOW,
          }),
        }),
      ),
      question(Analysis.countOverWindow(Window.lastDays(7), "peak")),
      schema,
    );
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.failure.kind).toBe("InvalidQuery");
  });
});

describe("a series analysis", () => {
  test("the buckets come back as ISO instants", async () => {
    const answer = await ask(
      deps(answering({})),
      question(
        Analysis.timeSeries(Measure.count(), Window.lastDays(2), "hour"),
      ),
      schema,
    );
    expect(answer.ok).toBe(true);
    if (!answer.ok || answer.value.shape !== "series") return;
    expect(answer.value.points[0]).toEqual({
      bucketStart: Instant.toISO(NOW),
      value: 1,
    });
    expect(answer.value.points).toHaveLength(3);
  });

  test("the measure decides which builder is called", async () => {
    const called: string[] = [];
    const engine = unavailableEngine({
      counts: async () => {
        called.push("counts");
        return { ok: true, value: { buckets: [] }, computedAt: NOW };
      },
      uniques: async () => {
        called.push("uniques");
        return { ok: true, value: { buckets: [] }, computedAt: NOW };
      },
      sums: async () => {
        called.push("sums");
        return { ok: true, value: { buckets: [] }, computedAt: NOW };
      },
    });

    await ask(
      deps(engine),
      question(
        Analysis.timeSeries(Measure.count(), Window.lastDays(1), "hour"),
      ),
      schema,
    );
    await ask(
      deps(engine),
      question(
        Analysis.timeSeries(Measure.uniqueVisits(), Window.lastDays(1), "hour"),
      ),
      schema,
    );
    await ask(
      deps(engine),
      question(
        Analysis.timeSeries(Measure.sum("revenue"), Window.lastDays(1), "hour"),
      ),
      schema,
    );

    expect(called).toEqual(["counts", "uniques", "sums"]);
  });
});

describe("filters", () => {
  test("an event restriction becomes the query's event, not a filter", async () => {
    const seen: SeriesQuery[] = [];
    await ask(
      deps(answering({}, seen)),
      question({
        shape: "series",
        measure: Measure.count(),
        window: Window.lastDays(1),
        grain: "hour",
        where: Predicate.eq(FieldRef.dimension("event_type"), "purchase"),
      }),
      schema,
    );
    expect(seen[0]?.event).toBe("purchase");
    expect(seen[0]?.filters).toEqual({});
  });

  test("dimension equality becomes a flat filter", async () => {
    const seen: SeriesQuery[] = [];
    await ask(
      deps(answering({}, seen)),
      question({
        shape: "series",
        measure: Measure.count(),
        window: Window.lastDays(1),
        grain: "hour",
        where: Predicate.eq(FieldRef.dimension("os_name"), "ios"),
      }),
      schema,
    );
    expect(seen[0]?.filters).toEqual({ os_name: "ios" });
  });

  /**
   * `country` is declared and not collected. Answering it with an empty series
   * is the exact failure this whole layer exists to prevent: a chart that says
   * "no traffic from anywhere" when the truth is "we do not record that yet".
   */
  test("a planned-but-uncollected dimension is refused with the reason", async () => {
    const answer = await ask(
      deps(answering({})),
      question({
        shape: "series",
        measure: Measure.count(),
        window: Window.lastDays(1),
        grain: "hour",
        where: Predicate.eq(FieldRef.dimension("country"), "GB"),
      }),
      schema,
    );
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.failure.kind).toBe("InvalidQuery");
    expect(
      answer.failure.kind === "InvalidQuery" && answer.failure.detail,
    ).toContain("country");
  });

  test("a scan predicate reaches the engine intact instead of being dropped", async () => {
    const seen: SeriesQuery[] = [];
    const predicate = Predicate.contains(FieldRef.dimension("os_name"), "i");
    const answer = await ask(deps(answering({}, seen)), question({
      shape: "series", measure: Measure.count(), window: Window.lastDays(1), grain: "hour", where: predicate,
    }), schema);
    expect(answer.ok).toBe(true);
    expect(seen[0]?.predicate).toEqual(predicate);
  });

});

describe("a breakdown", () => {
  const rows = (
    entries: readonly { key: string | null; value: number }[],
  ): EngineOutcome<Breakdown> => ({
    ok: true,
    value: { rows: entries },
    computedAt: NOW,
  });

  /**
   * One query, and the rows come from the data.
   *
   * This used to be one query per value, with the values fetched first from
   * `SchemaCatalog.dimensionValues` — litics had no group-by, so `limit` was a
   * fan-out bound. It groups now: the engine ranks and cuts, and this layer
   * only names the rows.
   */
  test("is one engine call, carrying the dimension, order and limit", async () => {
    const seen: BreakdownQuery[] = [];
    const engine = unavailableEngine({
      countsBy: async (query) => {
        seen.push(query);
        return rows([
          { key: "android", value: 9 },
          { key: "ios", value: 5 },
          { key: "web", value: 1 },
        ]);
      },
    });

    const answer = await ask(
      deps(
        engine,
        fixedCatalog({ dimensionValues: async () => ["never asked for"] }),
      ),
      question(
        Analysis.breakdown(
          Measure.count(),
          FieldRef.dimension("os_name"),
          Window.lastDays(1),
          3,
        ),
      ),
      schema,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ by: "os_name", order: "desc", limit: 3 });
    expect(answer).toMatchObject({
      ok: true,
      value: {
        shape: "breakdown",
        dimensions: [{ key: "os_name", label: "os_name" }],
        rows: [
          { label: "android", value: 9 },
          { label: "ios", value: 5 },
          { label: "web", value: 1 },
        ],
      },
    });
  });

  test("a unique breakdown asks for a union, not a series it would have to add up", async () => {
    const seen: BreakdownQuery[] = [];
    const engine = unavailableEngine({
      uniquesBy: async (query) => {
        seen.push(query);
        return rows([{ key: "ios", value: 3 }]);
      },
    });

    const answer = await ask(
      deps(engine),
      question(
        Analysis.breakdown(
          Measure.uniqueVisits(),
          FieldRef.dimension("os_name"),
          Window.lastDays(30),
          5,
        ),
      ),
      schema,
    );
    expect(seen).toHaveLength(1);
    expect(answer).toMatchObject({
      ok: true,
      value: { rows: [{ label: "ios", value: 3 }] },
    });
  });

  /**
   * A failure is still a failure. Drawing the rows that did arrive would
   * silently re-rank the chart, and nothing on the page would say so.
   */
  test("a failed breakdown fails the whole readout", async () => {
    const engine = unavailableEngine({
      countsBy: async () => ({
        ok: false,
        error: { kind: "Timeout", budget: Duration.seconds(5) },
      }),
    });

    const answer = await ask(
      deps(engine),
      question(
        Analysis.breakdown(
          Measure.count(),
          FieldRef.dimension("os_name"),
          Window.lastDays(1),
          2,
        ),
      ),
      schema,
    );
    expect(answer).toMatchObject({ ok: false, failure: { kind: "Timeout" } });
  });

  test("events that carried no value are a labelled row, not a dropped one", async () => {
    // The wire's `label` is a string, so the null the engine reports has to be
    // written as something. Dropping the row would make the bars stop adding
    // up to the total the same question answers as a scalar.
    const engine = unavailableEngine({
      countsBy: async () =>
        rows([
          { key: "ios", value: 9 },
          { key: null, value: 4 },
        ]),
    });

    const answer = await ask(
      deps(engine),
      question(
        Analysis.breakdown(
          Measure.count(),
          FieldRef.dimension("os_name"),
          Window.lastDays(1),
          5,
        ),
      ),
      schema,
    );
    expect(answer).toMatchObject({
      ok: true,
      value: {
        rows: [
          { label: "ios", value: 9 },
          { label: UNSET_LABEL, value: 4 },
        ],
      },
    });
  });

  test("no rows is an answer, not a failure", async () => {
    const engine = unavailableEngine({ countsBy: async () => rows([]) });
    const answer = await ask(
      deps(engine),
      question(
        Analysis.breakdown(
          Measure.count(),
          FieldRef.dimension("os_name"),
          Window.lastDays(1),
          5,
        ),
      ),
      schema,
    );
    expect(answer).toMatchObject({
      ok: true,
      value: { shape: "breakdown", rows: [] },
    });
  });

  test("a breakdown by a dimension nothing collects is refused with the reason", async () => {
    // The engine is never reached: the domain classifies the field first, so
    // the answer says "not collected yet" instead of being an empty table.
    const engine = unavailableEngine({
      countsBy: async () => {
        throw new Error("the engine must not be asked");
      },
    });

    const answer = await ask(
      deps(engine),
      question(
        Analysis.breakdown(
          Measure.count(),
          FieldRef.dimension("country"),
          Window.lastDays(1),
          5,
        ),
      ),
      schema,
    );
    expect(answer).toMatchObject({
      ok: false,
      failure: { kind: "InvalidQuery" },
    });
  });
});

describe("a funnel", () => {
  const threeSteps = Funnel.of(
    [
      FunnelStep.of(["view"], undefined, "Viewed"),
      FunnelStep.of(["start"], undefined, "Started"),
      FunnelStep.of(["finish"], undefined, "Finished"),
    ],
    Window.lastDays(7),
  );

  test("three single-event steps are answered and summarised", async () => {
    const answer = await ask(
      deps(
        unavailableEngine({
          funnel: async () => ({
            ok: true,
            value: { counts: [100, 50, 25] },
            computedAt: NOW,
          }),
        }),
      ),
      question(Analysis.ofFunnel(threeSteps)),
      schema,
    );
    expect(answer).toMatchObject({
      ok: true,
      value: { shape: "funnel", result: { overallRate: 25 } },
    });
  });

  /**
   * litics' builder is a three-tuple of bare event names. Reducing a richer
   * funnel to fit is precisely what v1 did when it discarded per-step filters,
   * and the resulting chart was wrong without saying so.
   */
  test("a four-step funnel is refused with the reason", async () => {
    const answer = await ask(
      deps(unavailableEngine({})),
      question(
        Analysis.ofFunnel(
          Funnel.of(
            [
              FunnelStep.of(["a"]),
              FunnelStep.of(["b"]),
              FunnelStep.of(["c"]),
              FunnelStep.of(["d"]),
            ],
            Window.lastDays(7),
          ),
        ),
      ),
      schema,
    );
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(
      answer.failure.kind === "InvalidQuery" && answer.failure.detail,
    ).toContain("3");
  });

  /**
   * Counts must be non-increasing: each step is a subset of the one before. A
   * rise means the engine answered a different question, and reporting it as
   * ours (`Unavailable`) rather than the caller's is correct — the funnel was
   * well-formed and there is nothing they can change.
   */
  test("non-monotonic counts are the engine's fault, not the caller's", async () => {
    const answer = await ask(
      deps(
        unavailableEngine({
          funnel: async () => ({
            ok: true,
            value: { counts: [10, 50, 5] },
            computedAt: NOW,
          }),
        }),
      ),
      question(Analysis.ofFunnel(threeSteps)),
      schema,
    );
    expect(answer).toMatchObject({
      ok: false,
      failure: { kind: "Unavailable" },
    });
  });
});

describe("the schema check", () => {
  test("an unknown measure is refused before the engine is called", async () => {
    let called = false;
    const answer = await ask(
      deps(
        unavailableEngine({
          sums: async () => {
            called = true;
            throw new Error("unreachable");
          },
        }),
      ),
      question(
        Analysis.timeSeries(Measure.sum("margin"), Window.lastDays(1), "day"),
      ),
      schema,
    );
    expect(called).toBe(false);
    expect(answer.ok).toBe(false);
  });
});

describe("failures never become numbers", () => {
  test("an engine timeout is reported, not zero-filled", async () => {
    const answer = await ask(
      deps(
        unavailableEngine({
          counts: async () => ({
            ok: false,
            error: { kind: "Timeout", budget: Duration.seconds(5) },
          }),
        }),
      ),
      question(Analysis.countOverWindow(Window.lastDays(1))),
      schema,
    );
    expect(answer).toEqual({
      ok: false,
      failure: { kind: "Timeout", budget: Duration.seconds(5) },
    });
  });

  test("retention is not implemented and the type says so", async () => {
    const engine = unavailableEngine({});
    const outcome = await engine.retention(
      {
        scope: { level: "project", project: PROJECT },
        bounds: { from: NOW, to: NOW },
        cohortStep: "day",
        periods: 4,
      },
      { deadline: Duration.seconds(1), traceId: "t" },
    );
    // The port's return type has no success branch, so a caller cannot render
    // an empty grid nobody can tell apart from "no data".
    expect(outcome.ok).toBe(false);
    expect(outcome.error.feature).toBe("retention");
  });
});

describe("Insight flexibility", () => {
  test("a unique total requests one whole-period union", async () => {
    const seen: SeriesQuery[] = [];
    const engine = answering({
      uniques: async (query) => {
        seen.push(query);
        return { ok: true, computedAt: NOW, value: { buckets: buckets(4) } };
      },
    });
    const analysis: Analysis = {
      shape: "scalar",
      measure: Measure.uniqueVisits(),
      summary: "total",
      window: Window.lastDays(7),
    };
    const result = await ask(deps(engine), question(analysis), schema);
    expect(seen[0]?.wholeWindow).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      value: { shape: "scalar", value: 4 },
    });
  });

  test("multiple properties return named columns and unambiguous tuple keys", async () => {
    const seen: BreakdownQuery[] = [];
    const engine = answering({
      countsBy: async (query) => {
        seen.push(query);
        return {
          ok: true,
          computedAt: NOW,
          value: {
            rows: [{ key: '["ios",null]', keys: ["ios", null], value: 8 }],
          },
        };
      },
    });
    const analysis: Analysis = {
      shape: "breakdown",
      measure: Measure.count(),
      window: Window.lastDays(7),
      by: [FieldRef.dimension("os_name"), FieldRef.dimension("locale")],
      order: "desc",
      limit: 10,
    };
    const result = await ask(deps(engine), question(analysis), schema);
    expect(seen[0]?.by).toEqual(["os_name", "locale"]);
    expect(result).toMatchObject({
      ok: true,
      value: {
        shape: "breakdown",
        dimensions: [
          { key: "os_name", label: "os_name" },
          { key: "locale", label: "locale" },
        ],
        rows: [{ label: "ios · (not set)", keys: ["ios", null], value: 8 }],
      },
    });
  });

  test("a split trend ranks distinct groups across the period, not by sums of daily uniques", async () => {
    const engine = answering({
      uniquesBy: async () => ({
        ok: true,
        computedAt: NOW,
        value: {
          rows: [
            { key: "a", value: 4 },
            { key: "b", value: 3 },
          ],
        },
      }),
      uniques: async (query) => {
        expect(query.by).toBe("event_type");
        return {
          ok: true,
          computedAt: NOW,
          value: {
            buckets: [],
            groups: [
              { key: "b", buckets: buckets(3, 3) },
              { key: "a", buckets: buckets(2, 2) },
              { key: "c", buckets: buckets(1, 1) },
            ],
          },
        };
      },
    });
    const analysis: Analysis = {
      shape: "series",
      measure: Measure.uniqueVisits(),
      window: Window.lastDays(7),
      grain: "day",
      by: FieldRef.dimension("event_type"),
      limit: 2,
    };
    const result = await ask(deps(engine), question(analysis), schema);
    if (!result.ok || result.value.shape !== "series")
      throw new Error("Expected a trend");
    expect(result.value.series?.map((group) => group.label)).toEqual([
      "a",
      "b",
    ]);
    expect(
      result.value.series?.map((group) =>
        group.points.map((point) => point.value),
      ),
    ).toEqual([
      [2, 2],
      [3, 3],
    ]);
    expect(result.value.points).toEqual([]);
  });

  test("a failed group ranking fails the insight rather than silently using another ranking", async () => {
    let seriesCalled = false;
    const engine = answering({
      countsBy: async () => ({
        ok: false,
        error: { kind: "Unavailable", detail: "offline" },
      }),
      counts: async () => {
        seriesCalled = true;
        return { ok: true, computedAt: NOW, value: { buckets: [] } };
      },
    });
    const analysis: Analysis = {
      shape: "series",
      measure: Measure.count(),
      window: Window.lastDays(7),
      grain: "day",
      by: FieldRef.dimension("event_type"),
    };
    const result = await ask(deps(engine), question(analysis), schema);
    expect(result.ok).toBe(false);
    expect(seriesCalled).toBe(false);
  });
});

test("person-based questions never return visit counts", async () => {
  const seen: SeriesQuery[] = [];
  const answer = await ask(deps(answering({}, seen)), question({shape: "scalar", measure: {kind: "unique", basis: "person"}, window: Window.lastDays(1), summary: "total"}), schema);
  expect(answer.ok).toBe(false);
  expect(seen).toHaveLength(0);
});
