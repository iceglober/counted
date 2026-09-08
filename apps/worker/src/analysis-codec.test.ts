import { describe, expect, test } from "bun:test";

import { Analysis, FieldRef, Measure, Predicate, Window } from "@counted/analytics-domain";
import { Duration, Instant } from "@counted/kernel";

import { analysisCodec, parseAnalysis, UnreadableAnalysisError } from "./analysis-codec";

describe("reading a stored analysis", () => {
  test("a scalar analysis survives a round trip through JSON unchanged", () => {
    const original: Analysis = {
      shape: "scalar",
      measure: Measure.uniqueVisits(),
      where: Predicate.eq(FieldRef.dimension("event_type"), "signup"),
      window: Window.between(Instant.fromEpochMillis(1000), Instant.fromEpochMillis(2000)),
      summary: "peak",
    };

    const stored = JSON.parse(JSON.stringify(analysisCodec.encode(original))) as unknown;

    expect(analysisCodec.decode(stored)).toEqual(original);
  });

  test("a value that is not an analysis is refused, not cast", () => {
    expect(parseAnalysis({ shape: "scalar", measure: { kind: "median" } })).toBeNull();
    expect(parseAnalysis({ shape: "pie-chart" })).toBeNull();
    expect(parseAnalysis(null)).toBeNull();
    expect(parseAnalysis("scalar")).toBeNull();
    expect(() => analysisCodec.decode({})).toThrow(UnreadableAnalysisError);
  });

  /**
   * The rule this pins: a stored `property` named `locale` stays a property. It
   * cannot be promoted to the dimension of the same name, because the index
   * column called `locale` holds our value and not the customer's — the query
   * would succeed and answer about the wrong data.
   */
  test("a customer property that shadows one of our dimensions stays a property", () => {
    const parsed = parseAnalysis({
      shape: "scalar",
      summary: "total",
      measure: { kind: "count" },
      window: { kind: "relative", amount: 1, unit: "day" },
      where: { op: "eq", field: { source: "property", key: "locale" }, value: "en-GB" },
    });

    expect(parsed).not.toBeNull();
    const where = Analysis.where(parsed as Analysis);
    expect(where).toEqual(Predicate.eq(FieldRef.property("locale"), "en-GB"));
    expect(FieldRef.isShadowed(FieldRef.property("locale"))).toBe(true);
  });

  test("a dimension name this version no longer declares is refused, not demoted", () => {
    expect(
      parseAnalysis({
        shape: "scalar",
        summary: "total",
        measure: { kind: "count" },
        window: { kind: "relative", amount: 1, unit: "day" },
        where: { op: "eq", field: { source: "dimension", key: "planet" }, value: "earth" },
      }),
    ).toBeNull();
  });

  test("a funnel's conversion deadline is read from either spelling, never defaulted", () => {
    const base = {
      shape: "funnel",
      funnel: {
        steps: [{ events: ["view"] }, { events: ["buy"] }],
        window: { kind: "relative", amount: 7, unit: "day" },
        basis: "visit",
      },
    };

    const domainForm = parseAnalysis({
      ...base,
      funnel: { ...base.funnel, conversionWindow: { within: 3_600_000 } },
    });
    const wireForm = parseAnalysis({
      ...base,
      funnel: { ...base.funnel, conversionWindowMs: 3_600_000 },
    });

    expect(domainForm).toEqual(wireForm);
    expect(domainForm).not.toBeNull();
    const analysis = domainForm as Extract<Analysis, { shape: "funnel" }>;
    expect(Duration.toMillis(analysis.funnel.conversionWindow.within)).toBe(3_600_000);

    // Neither spelling present is unreadable rather than seven days.
    expect(parseAnalysis(base)).toBeNull();
  });

  test("a predicate nested past any plausible depth is refused rather than recursed", () => {
    let deep: unknown = { op: "eq", field: { source: "property", key: "a" }, value: "b" };
    for (let i = 0; i < 50; i += 1) deep = { op: "not", operand: deep };

    expect(
      parseAnalysis({
        shape: "scalar",
        summary: "total",
        measure: { kind: "count" },
        window: { kind: "relative", amount: 1, unit: "day" },
        where: deep,
      }),
    ).toBeNull();
  });
});
