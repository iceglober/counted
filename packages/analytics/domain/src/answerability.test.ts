import { describe, expect, test } from "bun:test";
import { Answerability, classifyPredicate } from "./answerability";
import { DEFAULT_CATALOG, DimensionCatalog } from "./dimension";
import { FieldRef } from "./field";
import { Predicate } from "./predicate";

const locale = FieldRef.dimension("locale");
const os = FieldRef.dimension("os_name");
const eventType = FieldRef.dimension("event_type");
const country = FieldRef.dimension("country");
const plan = FieldRef.property("plan");

const classify = (p: Parameters<typeof classifyPredicate>[0], catalog = DEFAULT_CATALOG) =>
  classifyPredicate(p, catalog);

/**
 * A catalog where `country` is declared but this project's index does not carry
 * it — the `planned` state, which no dimension is in by default any more.
 *
 * `country` used to be the standing example: the product named it and no event
 * carried it. It is collected now (derived at ingest from the request address),
 * so the state has to be built rather than borrowed. It is still a state a real
 * project can be in — a catalog is a per-project value, and a database whose
 * index predates a dimension genuinely lacks the column — and it is the state
 * these tests are about.
 */
const COUNTRY_NOT_CARRIED = DimensionCatalog.of(
  DEFAULT_CATALOG.indexed.filter((key) => key !== "country"),
  ["country"],
);

describe("index-answerable predicates", () => {
  test("event-name sets stay indexed and deduplicate values", () => {
    expect(classify(Predicate.and(Predicate.in(eventType, ["view", "buy", "view"]), Predicate.eq(os, "iOS")))).toEqual({
      kind: "indexed", plan: { event: ["view", "buy"], filters: { os_name: "iOS" } }, queries: 1,
    });
  });

  test("event unions cannot hide invalid or repeated constraints", () => {
    expect(classify(Predicate.in(eventType, ["view", 3])).kind).toBe("scan");
    expect(classify(Predicate.in(eventType, [])).kind).toBe("scan");
    expect(classify(Predicate.and(Predicate.in(eventType, ["view", "buy"]), Predicate.eq(eventType, "buy"))).kind).toBe("scan");
    expect(classify(Predicate.in(FieldRef.property("event_type"), ["view", "buy"])).kind).toBe("scan");
  });
  test("no predicate at all is the cheapest query there is", () => {
    const a = classify(undefined);
    expect(a).toEqual({ kind: "indexed", plan: { filters: {} }, queries: 1 });
  });

  test("a conjunction of dimension equality becomes a flat filter map", () => {
    const a = classify(Predicate.and(Predicate.eq(locale, "en-GB"), Predicate.eq(os, "iOS")));
    expect(a).toEqual({
      kind: "indexed",
      plan: { filters: { locale: "en-GB", os_name: "iOS" } },
      queries: 1,
    });
  });

  test("event_type is lifted out of the filters, because the engine separates it", () => {
    const a = classify(Predicate.and(Predicate.eq(eventType, "purchase"), Predicate.eq(os, "iOS")));
    expect(a.kind).toBe("indexed");
    if (a.kind !== "indexed") return;
    expect(a.plan.event).toBe("purchase");
    expect(a.plan.filters).toEqual({ os_name: "iOS" });
  });

  test("a declared customer property is as cheap as one of ours", () => {
    const catalog = DimensionCatalog.withIndexed(DEFAULT_CATALOG, ["plan"]);
    const a = classify(Predicate.eq(plan, "pro"), catalog);
    expect(Answerability.isCheap(a)).toBe(true);
  });
});

describe("predicates that force a raw scan, each with its reason", () => {
  const scanReasons = (p: Predicate, catalog = DEFAULT_CATALOG) => {
    const a = classify(p, catalog);
    expect(a.kind).toBe("scan");
    return a.kind === "scan" ? a.reasons.map((r) => r.kind) : [];
  };

  test("an operator that is not equality", () => {
    expect(scanReasons(Predicate.contains(locale, "en"))).toEqual(["UnsupportedOperator"]);
    expect(scanReasons(Predicate.in(locale, ["en", "fr"]))).toEqual(["UnsupportedOperator"]);
  });

  test("a disjunction, because an indexed filter holds one value per dimension", () => {
    expect(scanReasons(Predicate.or(Predicate.eq(locale, "en"), Predicate.eq(os, "iOS")))).toEqual([
      "Disjunction",
    ]);
  });

  test("a negation", () => {
    expect(scanReasons(Predicate.not(Predicate.eq(locale, "en")))).toEqual(["Negation"]);
  });

  test("an undeclared property", () => {
    expect(scanReasons(Predicate.eq(plan, "pro"))).toEqual(["UndeclaredDimension"]);
  });

  test("a property whose name is already one of ours — v1 silently picked ours", () => {
    expect(scanReasons(Predicate.eq(FieldRef.property("locale"), "en"))).toEqual([
      "ShadowedDimension",
    ]);
  });

  test("the same dimension constrained twice", () => {
    expect(scanReasons(Predicate.and(Predicate.eq(locale, "en"), Predicate.eq(locale, "fr")))).toEqual(
      ["RepeatedDimension"],
    );
  });

  test("two event_type equalities, which is the same collision", () => {
    expect(
      scanReasons(Predicate.and(Predicate.eq(eventType, "a"), Predicate.eq(eventType, "b"))),
    ).toEqual(["RepeatedDimension"]);
  });

  test("a non-string value, because indexed dimension values are strings", () => {
    expect(scanReasons(Predicate.eq(locale, 42))).toEqual(["NonStringValue"]);
  });

  test("every reason is reported, not just the first", () => {
    const p = Predicate.and(
      Predicate.contains(locale, "en"),
      Predicate.eq(plan, "pro"),
      Predicate.eq(os, 1),
    );
    expect(scanReasons(p)).toEqual([
      "UnsupportedOperator",
      "UndeclaredDimension",
      "NonStringValue",
    ]);
  });
});

describe("questions that cannot be answered at all", () => {
  test("a filter on a dimension the index does not carry is unanswerable, not slow", () => {
    const a = classify(Predicate.eq(country, "GB"), COUNTRY_NOT_CARRIED);
    expect(a).toEqual({
      kind: "unanswerable",
      reasons: [{ kind: "DimensionNotCollected", key: "country" }],
    });
  });

  test("a blocker inside an or still blocks: a scan over an empty column returns nothing", () => {
    const a = classify(
      Predicate.or(Predicate.eq(country, "GB"), Predicate.eq(locale, "en")),
      COUNTRY_NOT_CARRIED,
    );
    expect(a.kind).toBe("unanswerable");
  });

  test("unanswerable beats scan — being simple cannot rescue a missing column", () => {
    const a = classify(
      Predicate.and(Predicate.contains(locale, "en"), Predicate.eq(country, "GB")),
      COUNTRY_NOT_CARRIED,
    );
    expect(a.kind).toBe("unanswerable");
    expect(Answerability.severity(a)).toBe(2);
  });

  test("the same filter is cheap once the store indexes the column", () => {
    // Which is the state every project is in today: `country` is derived at
    // ingest and `DEFAULT_CATALOG` indexes it.
    expect(Answerability.isCheap(classify(Predicate.eq(country, "GB")))).toBe(true);
    expect(
      Answerability.isCheap(
        classify(Predicate.eq(country, "GB"), DimensionCatalog.withIndexed(COUNTRY_NOT_CARRIED, ["country"])),
      ),
    ).toBe(true);
  });
});

describe("describe", () => {
  test("names the cause rather than saying the query failed", () => {
    expect(
      Answerability.describe(classify(Predicate.eq(country, "GB"), COUNTRY_NOT_CARRIED)),
    ).toContain("not collected yet");
    expect(Answerability.describe(classify(Predicate.contains(locale, "e")))).toContain(
      "not an indexed filter",
    );
  });
});
