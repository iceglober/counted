import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "@counted/kernel";
import { Analysis, MAX_BREAKDOWN_LIMIT, type ProjectSchema } from "./analysis";
import { DEFAULT_CATALOG, DimensionCatalog } from "./dimension";
import { FieldRef } from "./field";
import { Funnel, FunnelStep } from "./funnel";
import { Measure } from "./measure";
import { Predicate } from "./predicate";
import { MAX_WINDOW, Window } from "./window";

const week = Window.lastDays(7);
const locale = FieldRef.dimension("locale");
const eventType = FieldRef.dimension("event_type");
const schema: ProjectSchema = {
  dimensions: DEFAULT_CATALOG,
  measures: ["revenue"],
};

describe("one definition, four shapes", () => {
  test("the shape of the answer is stated, not inferred from a missing field", () => {
    expect(Analysis.readoutShape(Analysis.countOverWindow(week))).toBe(
      "scalar",
    );
    expect(
      Analysis.readoutShape(Analysis.timeSeries(Measure.count(), week)),
    ).toBe("series");
    expect(
      Analysis.readoutShape(Analysis.breakdown(Measure.count(), locale, week)),
    ).toBe("breakdown");
    expect(
      Analysis.readoutShape(
        Analysis.ofFunnel(
          Funnel.of([FunnelStep.of(["a"]), FunnelStep.of(["b"])], week),
        ),
      ),
    ).toBe("funnel");
  });

  test("a monitor can ask whether an analysis produces one number", () => {
    expect(Analysis.isScalar(Analysis.countOverWindow(week))).toBe(true);
    expect(Analysis.isScalar(Analysis.timeSeries(Measure.count(), week))).toBe(
      false,
    );
  });

  test("an event restriction is a predicate, not a second field", () => {
    // v1 had `events: string[]` on an insight and `eventFilter: string` on an
    // alert: one restriction, two spellings, two compilers.
    const a: Analysis = {
      shape: "scalar",
      measure: Measure.count(),
      window: week,
      summary: "total",
      where: Predicate.eq(eventType, "purchase"),
    };
    const answer = Analysis.answerability(a, DEFAULT_CATALOG);
    expect(answer.kind === "indexed" && answer.plan.event).toBe("purchase");
  });

  test("a series states its grain rather than resolving one at query time", () => {
    const a = Analysis.timeSeries(Measure.count(), Window.lastDays(30));
    expect(a.shape === "series" && a.grain).toBe("day");
  });
});

describe("withWindow", () => {
  test("rebases without a tile storing a second copy of the question", () => {
    const a = Analysis.timeSeries(Measure.count(), week, "day");
    const rebased = Analysis.withWindow(a, Window.lastDays(30));
    expect(Analysis.window(rebased)).toEqual(Window.lastDays(30));
    expect(rebased.shape).toBe("series");
    expect(rebased.shape === "series" && rebased.grain).toBe("day");
  });

  test("reaches inside a funnel too", () => {
    const f = Funnel.of([FunnelStep.of(["a"]), FunnelStep.of(["b"])], week);
    const rebased = Analysis.withWindow(
      Analysis.ofFunnel(f),
      Window.lastDays(30),
    );
    expect(Analysis.window(rebased)).toEqual(Window.lastDays(30));
  });
});

describe("toKey", () => {
  test("two tiles asking the same thing share a key, so they run once", () => {
    const a = Analysis.timeSeries(Measure.count(), week, "day");
    const b = Analysis.timeSeries(Measure.count(), Window.lastDays(7), "day");
    expect(Analysis.toKey(a)).toBe(Analysis.toKey(b));
  });

  test("a different grain is a different question", () => {
    expect(
      Analysis.toKey(Analysis.timeSeries(Measure.count(), week, "day")),
    ).not.toBe(
      Analysis.toKey(Analysis.timeSeries(Measure.count(), week, "hour")),
    );
  });

  test("shapes never collide, even with the same measure and window", () => {
    expect(Analysis.toKey(Analysis.countOverWindow(week))).not.toBe(
      Analysis.toKey(Analysis.timeSeries(Measure.count(), week, "day")),
    );
  });
});

describe("structural validity", () => {
  test("a well-formed analysis passes", () => {
    expect(Analysis.validate(Analysis.countOverWindow(week)).ok).toBe(true);
  });

  test("every defect is reported at once, not one per round trip", () => {
    const a: Analysis = {
      shape: "breakdown",
      measure: Measure.sum("  "),
      window: Window.lastDays(0),
      by: FieldRef.property(" "),
      order: "desc",
      limit: 0,
      where: Predicate.in(locale, []),
    };
    expect(Analysis.defects(a).map((d) => d.kind)).toEqual([
      "EmptyMeasureName",
      "EmptyValueList",
      "EmptyPropertyKey",
      "LimitOutOfRange",
      "NonPositiveWindow",
    ]);
  });

  test("the defects are flattened into the one detail string the wire carries", () => {
    const result = Analysis.validate(
      Analysis.timeSeries(Measure.count(), Window.lastDays(0)),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("InvalidAnalysis");
    expect(result.error).toHaveProperty("detail");
  });

  test("an inverted absolute window is refused", () => {
    const from = Instant.fromEpochMillis(2_000);
    const to = Instant.fromEpochMillis(1_000);
    const a = Analysis.countOverWindow(Window.between(from, to));
    expect(Analysis.defects(a).map((d) => d.kind)).toEqual(["InvertedWindow"]);
  });

  test("a breakdown limit is bounded, because the limit is a query fan-out", () => {
    const over = Analysis.breakdown(
      Measure.count(),
      locale,
      week,
      MAX_BREAKDOWN_LIMIT + 1,
    );
    expect(Analysis.defects(over).map((d) => d.kind)).toEqual([
      "LimitOutOfRange",
    ]);
  });

  test("a window past the ceiling is refused before it reaches the engine", () => {
    const result = Analysis.validate(
      Analysis.countOverWindow(Window.lastDays(731)),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "WindowTooLarge",
      max: Duration.toMillis(MAX_WINDOW),
    });
  });
});

describe("validity against what a project actually has", () => {
  test("a custom property remains queryable outside catalog suggestions", () => {
    const a = Analysis.breakdown(Measure.count(), FieldRef.property("plan"), week);
    expect(Analysis.check(a, schema).ok).toBe(true);
    expect(Analysis.answerability(a, schema.dimensions).kind).toBe("scan");
  });

  test("a declared field passes", () => {
    const declared: ProjectSchema = {
      dimensions: DimensionCatalog.withIndexed(DEFAULT_CATALOG, ["plan"]),
      measures: [],
    };
    const a = Analysis.breakdown(
      Measure.count(),
      FieldRef.property("plan"),
      week,
    );
    expect(Analysis.check(a, declared).ok).toBe(true);
  });

  test("summing a measure the project does not declare is caught", () => {
    const a = Analysis.timeSeries(Measure.sum("latency"), week, "day");
    const result = Analysis.check(a, schema);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "UnknownMeasure",
      measure: "latency",
    });
  });

  test("a declared name a project's index lacks is not an unknown dimension", () => {
    // "no such field" and "not carried by this project's index" read
    // differently to a person and are reported differently: this one passes
    // `check` and is caught by `answerability`. `check` is about the vocabulary,
    // which is global; `answerability` is about one project's columns.
    const a = Analysis.breakdown(
      Measure.count(),
      FieldRef.dimension("country"),
      week,
    );
    expect(Analysis.check(a, schema).ok).toBe(true);

    const notCarried = DimensionCatalog.of(
      DEFAULT_CATALOG.indexed.filter((key) => key !== "country"),
      ["country"],
    );
    expect(Analysis.answerability(a, notCarried).kind).toBe("unanswerable");
    // And on a project whose index does carry it — every project today — the same
    // question is an ordinary indexed read.
    expect(Analysis.answerability(a, DEFAULT_CATALOG).kind).toBe("indexed");
  });
});

describe("answerability at the level of a whole question", () => {
  test("a scalar with a simple filter is one indexed read", () => {
    const a: Analysis = {
      shape: "scalar",
      measure: Measure.count(),
      window: week,
      summary: "total",
      where: Predicate.eq(locale, "en-GB"),
    };
    expect(Analysis.answerability(a, DEFAULT_CATALOG)).toEqual({
      kind: "indexed",
      plan: { filters: { locale: "en-GB" } },
      queries: 1,
    });
  });

  test("a breakdown is one query, because the engine groups over the dimension's own column", () => {
    // It used to be one query per value, and `limit` was the fan-out bound.
    // litics groups now, so the limit is how many rows come back and nothing
    // about what it costs to get them.
    const a = Analysis.breakdown(Measure.count(), locale, week, 25);
    const answer = Analysis.answerability(a, DEFAULT_CATALOG);
    expect(answer.kind).toBe("indexed");
    expect(answer.kind === "indexed" && answer.queries).toBe(1);
  });

  test("a breakdown by a dimension no column carries is still refused, whatever the limit", () => {
    // Grouping cannot rescue what pre-aggregation threw away: an index that was
    // not built with the column added those rows together when it wrote them.
    // A catalog of its own, so this states the rule rather than whichever
    // dimension happens to be uncollected this month.
    const catalog = DimensionCatalog.of(["event_type", "locale"], ["country"]);

    const planned = Analysis.breakdown(
      Measure.count(),
      FieldRef.dimension("country"),
      week,
      5,
    );
    expect(Analysis.answerability(planned, catalog).kind).toBe("unanswerable");

    const unknown = Analysis.breakdown(
      Measure.count(),
      FieldRef.property("plan_tier"),
      week,
      5,
    );
    expect(Analysis.answerability(unknown, catalog).kind).toBe("scan");
  });

  test("a funnel's step filters are classified alongside its shape", () => {
    const f = Funnel.of(
      [
        FunnelStep.of(["view"]),
        FunnelStep.of(["cart"]),
        FunnelStep.of(
          ["purchase"],
          Predicate.eq(FieldRef.dimension("country"), "GB"),
        ),
      ],
      week,
    );
    // A catalog without `country`, because the point is that a step filter on a
    // dimension the index lacks is reported *alongside* the shape problem rather
    // than instead of it — and that needs a dimension the index lacks.
    const notCarried = DimensionCatalog.of(
      ["event_type", "locale"],
      ["country"],
    );
    const answer = Analysis.answerability(Analysis.ofFunnel(f), notCarried);
    expect(answer.kind).toBe("unanswerable");
    if (answer.kind !== "unanswerable") return;
    expect(answer.reasons.map((r) => r.kind)).toContain(
      "DimensionNotCollected",
    );
    expect(answer.reasons.map((r) => r.kind)).toContain(
      "StepPredicateUnsupported",
    );
  });

  test("fields lists every field the question touches, deduplicated", () => {
    const a: Analysis = {
      shape: "breakdown",
      measure: Measure.count(),
      window: week,
      by: locale,
      order: "desc",
      limit: 5,
      where: Predicate.and(
        Predicate.eq(locale, "en"),
        Predicate.eq(eventType, "purchase"),
      ),
    };
    expect(Analysis.fields(a).map(FieldRef.toKey)).toEqual([
      "dim:locale",
      "dim:event_type",
    ]);
  });
});

describe("properties that survive from measure to analysis", () => {
  test("a person-basis question is flagged all the way up", () => {
    expect(
      Analysis.requiresPerson(
        Analysis.timeSeries(Measure.uniquePeople(), week),
      ),
    ).toBe(true);
    expect(Analysis.requiresPerson(Analysis.countOverWindow(week))).toBe(false);
  });

  test("an approximate measure makes the analysis approximate", () => {
    expect(
      Analysis.isApproximate(Analysis.timeSeries(Measure.uniqueVisits(), week)),
    ).toBe(true);
    expect(Analysis.isApproximate(Analysis.countOverWindow(week))).toBe(false);
  });
});

describe("Insight grouping", () => {
  const grouped = (
    by: Extract<Analysis, { shape: "breakdown" }>["by"],
  ): Analysis => ({
    shape: "breakdown",
    measure: Measure.count(),
    window: Window.lastDays(7),
    by,
    order: "desc",
    limit: 10,
  });
  test("all grouping fields are checked and ordered tuples have distinct query keys", () => {
    const country = FieldRef.dimension("country"),
      os = FieldRef.dimension("os_name");
    const a = grouped([country, os]),
      b = grouped([os, country]);
    expect(Analysis.fields(a)).toEqual([country, os]);
    expect(Analysis.toKey(a)).not.toBe(Analysis.toKey(b));
    expect(Analysis.validate(a).ok).toBe(true);
    expect(Analysis.validate(grouped([])).ok).toBe(false);
    expect(Analysis.validate(grouped([country, country])).ok).toBe(false);
    expect(
      Analysis.validate(
        grouped([
          country,
          os,
          FieldRef.dimension("locale"),
          FieldRef.dimension("event_type"),
        ]),
      ).ok,
    ).toBe(false);
  });
  test("split trend properties participate in schema checks and query deduplication", () => {
    const base: Analysis = {
      shape: "series",
      measure: Measure.count(),
      window: Window.lastDays(7),
      grain: "day",
    };
    const split: Analysis = {
      ...base,
      by: FieldRef.dimension("country"),
      limit: 3,
    };
    expect(Analysis.toKey(base)).not.toBe(Analysis.toKey(split));
    expect(Analysis.fields(split)).toContainEqual(
      FieldRef.dimension("country"),
    );
    expect(Analysis.validate({ ...split, limit: 4 }).ok).toBe(false);
    expect(Analysis.validate({ ...base, limit: 3 }).ok).toBe(false);
  });
});
