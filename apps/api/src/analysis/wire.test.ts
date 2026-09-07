/**
 * The wire ↔ domain codec.
 *
 * `@counted/contract` restates the Analysis IR's closed vocabularies as literal
 * Zod enums, because it is a leaf and may not import `@counted/analytics-domain`.
 * That restatement is only safe if something checks the two agree, and this is
 * it: a round trip over every shape, every operator and both window kinds.
 *
 * The interesting test is the last one. A wire `FieldRef` with
 * `source: "dimension"` carries an open string; the domain's `DimensionName` is
 * closed. Re-reading an unknown name as a customer property would answer a
 * different question than the one asked and draw a plausible chart from it.
 */

import { describe, expect, test } from "bun:test";
import { Duration, Instant, isErr, isOk } from "@counted/kernel";
import {
  fromAnalysis,
  toAnalysis,
  toWindow,
  type WireAnalysis,
  type WirePredicateValue,
  type WireWindow,
} from "./wire";

const relative: WireWindow = { kind: "relative", amount: 7, unit: "day" };

const roundTrips = (wire: WireAnalysis): void => {
  const domain = toAnalysis(wire);
  expect(isOk(domain)).toBe(true);
  if (!isOk(domain)) return;
  expect(fromAnalysis(domain.value)).toEqual(wire);
};

describe("every analysis shape survives the round trip", () => {
  test("scalar", () => {
    roundTrips({
      shape: "scalar",
      measure: { kind: "count" },
      window: relative,
      summary: "peak",
    });
  });

  test("series", () => {
    roundTrips({
      shape: "series",
      measure: { kind: "unique", basis: "person" },
      window: relative,
      grain: "hour",
    });
  });

  test("breakdown", () => {
    roundTrips({
      shape: "breakdown",
      measure: { kind: "sum", name: "revenue" },
      window: {
        kind: "absolute",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
      },
      by: { source: "dimension", key: "os_name" },
      order: "asc",
      limit: 5,
    });
  });

  test("funnel", () => {
    roundTrips({
      shape: "funnel",
      funnel: {
        steps: [
          { label: "Visited", events: ["page_view"] },
          {
            events: ["signup_started"],
            where: {
              op: "eq",
              field: { source: "dimension", key: "locale" },
              value: "en",
            },
          },
          { events: ["signup_completed"] },
        ],
        window: relative,
        conversionWindowMs: Duration.toMillis(Duration.days(7)),
        basis: "person",
      },
    });
  });
});

describe("every predicate operator survives the round trip", () => {
  const field = { source: "dimension", key: "os_name" } as const;
  const property = { source: "property", key: "plan" } as const;

  const cases: WirePredicateValue[] = [
    { op: "eq", field, value: "ios" },
    { op: "neq", field, value: null },
    { op: "in", field, values: ["ios", "android"] },
    { op: "notIn", field, values: [1, true] },
    { op: "contains", field: property, value: "pro" },
    { op: "startsWith", field: property, value: "p" },
    { op: "endsWith", field: property, value: "o" },
    { op: "gt", field: property, value: 1 },
    { op: "gte", field: property, value: 1 },
    { op: "lt", field: property, value: 1 },
    { op: "lte", field: property, value: 1 },
    { op: "exists", field: property },
    { op: "notExists", field: property },
    { op: "not", operand: { op: "eq", field, value: "ios" } },
    {
      op: "and",
      operands: [
        { op: "eq", field, value: "ios" },
        { op: "exists", field: property },
      ],
    },
    {
      op: "or",
      operands: [
        { op: "eq", field, value: "ios" },
        { op: "eq", field, value: "android" },
      ],
    },
  ];

  for (const where of cases) {
    test(String((where as { op: string }).op), () => {
      roundTrips({
        shape: "scalar",
        measure: { kind: "count" },
        window: relative,
        where,
        summary: "total",
      });
    });
  }

  /**
   * `Predicate.and(x)` collapses a single operand, and an `and` of one is a
   * structural defect the domain's validator names. A codec that quietly
   * repaired it would hide a client bug and change the analysis's key, which is
   * what two identical questions are coalesced by.
   */
  test("an `and` of one is preserved, not collapsed", () => {
    roundTrips({
      shape: "scalar",
      measure: { kind: "count" },
      window: relative,
      where: { op: "and", operands: [{ op: "exists", field: property }] },
      summary: "total",
    });
  });
});

describe("windows", () => {
  test("an absolute window keeps its exact instants", () => {
    const converted = toWindow({
      kind: "absolute",
      from: "2026-03-01T12:00:00.000Z",
      to: "2026-03-02T12:00:00.000Z",
    });
    expect(isOk(converted)).toBe(true);
    if (!isOk(converted) || converted.value.kind !== "absolute") return;
    expect(Instant.toISO(converted.value.from)).toBe(
      "2026-03-01T12:00:00.000Z",
    );
  });

  test("a window bound that is not an instant is refused, not defaulted", () => {
    const converted = toWindow({
      kind: "absolute",
      from: "yesterday",
      to: "now",
    });
    expect(isErr(converted)).toBe(true);
    if (!isErr(converted)) return;
    expect(converted.error.kind).toBe("InvalidAnalysis");
  });
});

describe("dimension names", () => {
  test("a known dimension converts", () => {
    const converted = toAnalysis({
      shape: "breakdown",
      measure: { kind: "count" },
      window: relative,
      by: { source: "dimension", key: "locale" },
      order: "desc",
      limit: 10,
    });
    expect(isOk(converted)).toBe(true);
  });

  /**
   * The one fallible conversion, and the reason it is fallible. Re-reading an
   * unknown dimension as a property would filter a column that holds our value
   * rather than the customer's, and the chart would be wrong without saying so.
   */
  test("an unknown dimension is refused rather than re-read as a property", () => {
    const converted = toAnalysis({
      shape: "breakdown",
      measure: { kind: "count" },
      window: relative,
      by: { source: "dimension", key: "plan_tier" },
      order: "desc",
      limit: 10,
    });
    expect(isErr(converted)).toBe(true);
    if (!isErr(converted)) return;
    expect(converted.error).toEqual({
      kind: "UnknownDimension",
      dimension: "plan_tier",
    });
  });

  test("a property with the same name as a dimension stays a property", () => {
    const converted = toAnalysis({
      shape: "scalar",
      measure: { kind: "count" },
      window: relative,
      where: {
        op: "eq",
        field: { source: "property", key: "os_name" },
        value: "ios",
      },
      summary: "total",
    });
    expect(isOk(converted)).toBe(true);
    if (!isOk(converted) || converted.value.shape === "funnel") return;
    expect(converted.value.where).toEqual({
      op: "eq",
      field: { source: "property", key: "os_name" },
      value: "ios",
    });
  });
});

describe("Insight grouping survives storage and wire conversion", () => {
  test("an ordered property tuple", () => {
    roundTrips({
      shape: "breakdown",
      measure: { kind: "count" },
      window: relative,
      by: [
        { source: "dimension", key: "country" },
        { source: "dimension", key: "os_name" },
        { source: "dimension", key: "locale" },
      ],
      order: "desc",
      limit: 10,
    });
  });
  test("a grouped trend and its group cap", () => {
    roundTrips({
      shape: "series",
      measure: { kind: "unique", basis: "visit" },
      window: relative,
      grain: "day",
      by: { source: "dimension", key: "event_type" },
      limit: 3,
    });
  });
});
