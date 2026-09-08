import { describe, expect, test } from "bun:test";
import { build, draftFor, viewsFor, type Draft } from "./analysis";
import { AnalysisSchema } from "@counted/contract";

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  view: "number",
  measure: "events",
  event: undefined,
  windowAmount: 7,
  windowUnit: "day",
  grain: "day",
  dimension: undefined,
  limit: null,
  ...overrides,
});

describe("the view chooses the shape", () => {
  test("editing an insight offers only views that can display its existing analysis", () => {
    for (const view of ["number", "line", "bar", "table"] as const) {
      const result = build(draft({ view, dimension: "country" }));
      if (!result.ok) throw new Error(result.problem);
      expect(viewsFor(result.analysis.shape)).toContain(view);
    }
    expect(viewsFor("scalar")).not.toContain("line");
    expect(viewsFor("series")).toEqual(["line", "bar"]);
    expect(viewsFor("breakdown")).toEqual(["bar", "table"]);
    expect(viewsFor("funnel")).toEqual(["funnel"]);
  });
  test("a number is a scalar and a line is a series", () => {
    // Picking view and shape independently makes "a line chart of one number"
    // representable, and something then has to decide what that means.
    const number = build(draft({ view: "number" }));
    const line = build(draft({ view: "line" }));
    expect(number.ok && number.analysis.shape).toBe("scalar");
    expect(line.ok && line.analysis.shape).toBe("series");
  });

  test("a table carries the by-field and the row cap the engine needs", () => {
    const built = build(
      draft({ view: "table", dimension: "country", limit: 25 }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("unreachable");
    if (built.analysis.shape !== "breakdown")
      throw new Error("expected a breakdown");
    expect(built.analysis.by).toEqual({ source: "dimension", key: "country" });
    expect(built.analysis.limit).toBe(25);
  });

  test("a table without a dimension is refused rather than defaulted", () => {
    // Defaulting the slice would draw a chart of a question nobody asked.
    const built = build(draft({ view: "table" }));
    expect(built.ok).toBe(false);
  });

  test("bars compare property values when a breakdown is selected and time buckets otherwise", () => {
    const grouped = build(
      draft({
        view: "bar",
        dimension: "country",
        events: ["page_view"],
        limit: 5,
      }),
    );
    const table = build(
      draft({
        view: "table",
        dimension: "country",
        events: ["page_view"],
        limit: 5,
      }),
    );
    const trend = build(draft({ view: "bar" }));
    if (!grouped.ok || !table.ok || !trend.ok)
      throw new Error("Expected valid insights");
    expect(grouped.analysis).toEqual(table.analysis);
    expect(grouped.analysis).toMatchObject({
      shape: "breakdown",
      by: { source: "dimension", key: "country" },
      limit: 5,
      where: { op: "eq", value: "page_view" },
    });
    expect(trend.analysis.shape).toBe("series");
    expect(AnalysisSchema.safeParse(grouped.analysis).success).toBe(true);
  });

  test("a multi-event breakdown counts unique visits within each category", () => {
    const grouped = build(
      draft({
        view: "bar",
        dimension: "country",
        events: ["page_view", "pricing_viewed"],
        measure: "visits",
      }),
    );
    if (!grouped.ok) throw new Error(grouped.problem);
    expect(grouped.analysis).toMatchObject({
      shape: "breakdown",
      measure: { kind: "unique", basis: "visit" },
      where: { op: "in", values: ["page_view", "pricing_viewed"] },
    });
  });

  test("a breakdown wider than the cap is refused before it runs", () => {
    // The engine groups, so the cap bounds rows on screen, not round trips.
    expect(
      build(draft({ view: "table", dimension: "country", limit: 500 })).ok,
    ).toBe(false);
    for (const limit of [0, 1.5, NaN, Infinity, 101]) {
      expect(
        build(draft({ view: "bar", dimension: "country", limit })).ok,
      ).toBe(false);
    }
  });
});

describe("the window", () => {
  test("it stays relative", () => {
    // A tile that says "the last 7 days" has to still mean that tomorrow, so
    // the absolute bounds are computed at query time and never written down.
    const built = build(draft({ windowAmount: 7, windowUnit: "day" }));
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("unreachable");
    if (built.analysis.shape === "funnel")
      throw new Error("this form never builds a funnel");
    expect(built.analysis.window).toEqual({
      kind: "relative",
      amount: 7,
      unit: "day",
    });
  });

  test("zero and negative windows are refused", () => {
    expect(build(draft({ windowAmount: 0 })).ok).toBe(false);
    expect(build(draft({ windowAmount: null })).ok).toBe(false);
  });
});

describe("measures and filters", () => {
  test("multiple events use one valid union filter for every buildable view", () => {
    for (const view of ["number", "line", "bar", "table"]) {
      const result = build(
        draft({
          view,
          events: ["signup_started", "signup_completed"],
          dimension: "country",
        }),
      );
      if (!result.ok || result.analysis.shape === "funnel")
        throw new Error("Expected a buildable analysis");
      expect(result.analysis.where).toEqual({
        op: "in",
        field: { source: "dimension", key: "event_type" },
        values: ["signup_started", "signup_completed"],
      });
      expect(AnalysisSchema.safeParse(result.analysis).success).toBe(true);
      expect("events" in result.analysis).toBe(false);
    }
  });

  test("clearing a multi-selection includes all events, including future names", () => {
    const result = build(draft({ events: [], event: "previous_selection" }));
    if (!result.ok) throw new Error(result.problem);
    expect("where" in result.analysis).toBe(false);
  });

  test("duplicate choices cannot inflate an event filter and event spelling is preserved", () => {
    const result = build(
      draft({ events: ["Order Placed", "Order Placed", ""] }),
    );
    if (!result.ok || result.analysis.shape !== "scalar")
      throw new Error("Expected a scalar");
    expect(result.analysis.where).toEqual({
      op: "eq",
      field: { source: "dimension", key: "event_type" },
      value: "Order Placed",
    });
  });

  test("unique visits over multiple events remain a single distinct measure", () => {
    const result = build(draft({ measure: "visits", events: ["a", "b"] }));
    if (!result.ok || result.analysis.shape !== "scalar")
      throw new Error("Expected a scalar");
    expect(result.analysis.measure).toEqual({ kind: "unique", basis: "visit" });
    expect(result.analysis.where).toMatchObject({ op: "in" });
  });
  test("unique counts carry the basis, because visits and people differ", () => {
    const visits = build(draft({ measure: "visits" }));
    const people = build(draft({ measure: "people" }));
    expect(
      visits.ok &&
        visits.analysis.shape === "scalar" &&
        visits.analysis.measure,
    ).toEqual({
      kind: "unique",
      basis: "visit",
    });
    expect(
      people.ok &&
        people.analysis.shape === "scalar" &&
        people.analysis.measure,
    ).toEqual({
      kind: "unique",
      basis: "person",
    });
  });

  test("an event name becomes a predicate, not a second field", () => {
    // The contract has one filter language. v1 had `events: string[]` as well
    // and the two compilers disagreed about what an empty list meant.
    const built = build(draft({ event: "purchase" }));
    expect(
      built.ok && built.analysis.shape === "scalar" && built.analysis.where,
    ).toEqual({
      op: "eq",
      field: { source: "dimension", key: "event_type" },
      value: "purchase",
    });
  });

  test("no event name leaves the predicate off entirely", () => {
    const built = build(draft({}));
    expect(
      built.ok &&
        built.analysis.shape === "scalar" &&
        "where" in built.analysis,
    ).toBe(false);
  });

  test("a view the form cannot build is refused, not approximated", () => {
    expect(build(draft({ view: "funnel" })).ok).toBe(false);
    expect(build(draft({ view: "retention" })).ok).toBe(false);
  });
});

import { titleFor } from "./analysis";

describe("a derived title", () => {
  test("multiple event titles stay readable and within the contract limit", () => {
    expect(titleFor(draft({ events: ["a", "b", "a"] }))).toBe(
      "Events · 2 event types, last 7 days",
    );
    expect(
      titleFor(draft({ events: ["a".repeat(250)] })).length,
    ).toBeLessThanOrEqual(200);
  });
  const base = {
    view: "line",
    measure: "events",
    event: undefined,
    windowAmount: 7,
    windowUnit: "day",
    grain: "",
    dimension: undefined,
    limit: null,
  } as const;

  test("says the measure and the window", () => {
    expect(titleFor(base)).toBe("Events, last 7 days");
    expect(titleFor({ ...base, measure: "visits", windowAmount: 30 })).toBe(
      "Unique visits, last 30 days",
    );
    expect(titleFor({ ...base, windowAmount: 1, windowUnit: "hour" })).toBe(
      "Events, last 1 hour",
    );
  });

  test("names the event when there is one", () => {
    expect(titleFor({ ...base, event: "purchase" })).toBe(
      "Events · purchase, last 7 days",
    );
  });

  test("a table says what it is sliced by, in words", () => {
    expect(
      titleFor({
        ...base,
        view: "table",
        dimension: "event_type",
        windowAmount: 30,
      }),
    ).toBe("Events by event type, last 30 days");
  });

  test("a bar breakdown names the property while a bar trend names only the metric", () => {
    expect(
      titleFor({
        ...base,
        view: "bar",
        dimension: "country",
        events: ["page_view"],
      }),
    ).toBe("Events · page_view by country, last 7 days");
    expect(titleFor({ ...base, view: "bar" })).toBe("Events, last 7 days");
  });

  test("a sum names its property", () => {
    expect(titleFor({ ...base, measure: "sum:revenue" })).toBe(
      "Sum of revenue, last 7 days",
    );
  });
});

describe("Insight flexibility", () => {
  test("a breakdown preserves ordered properties while combining selected events", () => {
    const result = build(
      draft({
        view: "table",
        dimensions: ["country", "os_name"],
        events: ["signup_started", "signup_completed"],
      }),
    );
    if (!result.ok) throw new Error(result.problem);
    expect(result.analysis).toMatchObject({
      shape: "breakdown",
      by: [
        { source: "dimension", key: "country" },
        { source: "dimension", key: "os_name" },
      ],
      where: { op: "in" },
    });
    expect(AnalysisSchema.safeParse(result.analysis).success).toBe(true);
    expect(
      titleFor(draft({ view: "table", dimensions: ["country", "os_name"] })),
    ).toContain("country × os name");
  });
  test("duplicate and excessive breakdown properties are rejected", () => {
    for (const dimensions of [
      ["country", "country"],
      ["country", "os_name", "locale", "event_type"],
    ])
      expect(build(draft({ view: "table", dimensions })).ok).toBe(false);
  });
  test("a trend explicitly splits event types and keeps its interval", () => {
    const result = build(
      draft({
        view: "line",
        events: ["a", "b"],
        splitBy: "event_type",
        grain: "week",
      }),
    );
    if (!result.ok) throw new Error(result.problem);
    expect(result.analysis).toMatchObject({
      shape: "series",
      by: { source: "dimension", key: "event_type" },
      grain: "week",
      limit: 3,
    });
    expect(AnalysisSchema.safeParse(result.analysis).success).toBe(true);
  });
  test("clearing a trend split returns one combined series without stale grouping fields", () => {
    const result = build(
      draft({ view: "bar", splitBy: undefined, dimensions: [] }),
    );
    if (!result.ok) throw new Error(result.problem);
    expect(result.analysis.shape).toBe("series");
    expect(result.analysis).not.toHaveProperty("by");
  });
});

describe("editing and funnel composition", () => {
  test("a three-step visit funnel keeps its conversion deadline", () => {
    const built = build(draft({view: "funnel", funnelSteps: [{events: ["view"]}, {events: ["start"]}, {events: ["finish"]}], conversionMinutes: 15}));
    expect(built.ok && built.analysis).toMatchObject({shape: "funnel", funnel: {basis: "visit", conversionWindowMs: 900000}});
    if (built.ok) expect(AnalysisSchema.safeParse(built.analysis).success).toBe(true);
    expect(build(draft({view: "funnel", funnelSteps: [{events: ["view"]}]})).ok).toBe(false);
  });
  test("custom-property filters and grouping preserve their namespace", () => {
    const built = build(draft({view: "table", dimensions: ["property:country", "country"], where: {op: "contains", field: {source: "property", key: "url"}, value: "/docs"}}));
    if (!built.ok) throw new Error(built.problem);
    expect(built.analysis).toMatchObject({by: [{source: "property", key: "country"}, {source: "dimension", key: "country"}], where: {op: "contains"}});
  });
});

test("editing replaces only the selected event restriction and retains nested property predicates", () => {
  const filter = {op: "or" as const, operands: [{op: "eq" as const, field: {source: "property" as const, key: "url"}, value: "/"}, {op: "exists" as const, field: {source: "property" as const, key: "referrer"}}]};
  const original = {shape: "series" as const, measure: {kind: "count" as const}, window: {kind: "relative" as const, amount: 7, unit: "day" as const}, grain: "day" as const, where: {op: "and" as const, operands: [{op: "eq" as const, field: {source: "dimension" as const, key: "event_type"}, value: "view"}, filter]}};
  const restored = draftFor(original, "line");
  expect(restored.events).toEqual(["view"]);
  expect(restored.where).toEqual(filter);
  const changed = build({...restored, events: ["open"]});
  expect(changed.ok && changed.analysis).toMatchObject({where: {op: "and", operands: [{op: "eq", value: "open"}, filter]}});
});
