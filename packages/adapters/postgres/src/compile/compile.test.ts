import { describe, expect, test } from "bun:test";
import { FieldRef, Measure, Predicate } from "@counted/domain";
import { Params } from "./params";
import { compilePredicate } from "./predicate";
import { compileMeasure } from "./measure";
import { fieldAsLabel, fieldAsText, systemColumn } from "./column-map";

const compile = (p: Predicate) => {
  const params = new Params();
  const sql = compilePredicate(p, params);
  return { sql, values: params.all };
};

describe("property equality compiles to containment", () => {
  test("so the GIN index is usable — proven against a real planner in #33", () => {
    const { sql, values } = compile(Predicate.eq(FieldRef.property("plan"), "pro"));
    expect(sql).toContain("properties @>");
    expect(sql).not.toContain("->>");
    expect(values[0]).toBe(JSON.stringify({ plan: "pro" }));
  });

  test("IN becomes a disjunction of containments, keeping every branch indexable", () => {
    const { sql } = compile(Predicate.in(FieldRef.property("plan"), ["pro", "team"]));
    expect(sql.match(/properties @>/g)).toHaveLength(2);
    expect(sql).toContain(" OR ");
  });

  test("negation wraps the containment rather than abandoning it", () => {
    expect(compile(Predicate.neq(FieldRef.property("plan"), "pro")).sql).toMatch(/^NOT \(properties @>/);
  });

  test("numbers and booleans keep their JSON type inside the containment", () => {
    expect(compile(Predicate.eq(FieldRef.property("amount"), 100)).values[0]).toBe('{"amount":100}');
    expect(compile(Predicate.eq(FieldRef.property("trial"), false)).values[0]).toBe('{"trial":false}');
  });
});

describe("system fields are columns, never JSONB", () => {
  test("each maps to its own column", () => {
    expect(systemColumn("event_name")).toBe("name");
    expect(systemColumn("os_name")).toBe("os_name");
  });

  test("a customer property named like ours stays in JSONB", () => {
    // v1 checked its system allowlist first, so this property returned our
    // column's numbers.
    const ours = compile(Predicate.eq(FieldRef.system("locale"), "en-GB"));
    const theirs = compile(Predicate.eq(FieldRef.property("locale"), "en-GB"));
    expect(ours.sql).toContain("locale IS NOT DISTINCT FROM");
    expect(theirs.sql).toContain("properties @>");
  });

  test("equality on a column is NULL-safe", () => {
    // A plain `= NULL` never matches. IS NOT DISTINCT FROM does what a user means.
    expect(compile(Predicate.eq(FieldRef.system("country_code"), null)).sql).toContain("IS NOT DISTINCT FROM");
  });
});

describe("one guarded numeric cast, used everywhere", () => {
  test("comparisons guard the cast — v1's gt/lt did not", () => {
    // v1 emitted a bare (col)::numeric > $n, so one non-numeric row raised
    // 22P02 and failed the whole insight, which rendered as a blank card.
    const { sql } = compile(Predicate.gt(FieldRef.property("amount"), 100));
    expect(sql).toContain("jsonb_typeof");
    expect(sql).toContain("CASE");
  });

  test("aggregates use the same guard, not a second implementation", () => {
    const params = new Params();
    const sql = compileMeasure(Measure.aggregate("sum", "amount"), params);
    expect(sql).toContain("jsonb_typeof");
    expect(sql).toContain("SUM(");
  });

  test("it reads a JSON number directly and a numeric string as a fallback", () => {
    const { sql } = compile(Predicate.gte(FieldRef.property("amount"), 1));
    expect(sql).toContain("= 'number'");
    expect(sql).toContain("= 'string'");
  });

  test("all four comparisons are guarded", () => {
    for (const p of [
      Predicate.gt(FieldRef.property("a"), 1),
      Predicate.gte(FieldRef.property("a"), 1),
      Predicate.lt(FieldRef.property("a"), 1),
      Predicate.lte(FieldRef.property("a"), 1),
    ]) {
      expect(compile(p).sql).toContain("jsonb_typeof");
    }
  });
});

describe("measures", () => {
  test("distinct names its basis — two questions, two columns", () => {
    const p = new Params();
    expect(compileMeasure(Measure.distinctVisits(), p)).toBe("COUNT(DISTINCT visit_id)");
    expect(compileMeasure(Measure.distinctPeople(), p)).toBe("COUNT(DISTINCT person_id)");
  });

  test("an unidentified project honestly reports zero people", () => {
    // person_id is NULL without identify(), and COUNT(DISTINCT) skips NULLs.
    // v1 compiled unique_users to COUNT(DISTINCT session_id) and reported
    // visits as people.
    expect(compileMeasure(Measure.distinctPeople(), new Params())).toContain("person_id");
  });

  test("SUM of nothing is 0, not NULL", () => {
    expect(compileMeasure(Measure.aggregate("sum", "amount"), new Params())).toContain("COALESCE");
  });
});

describe("everything user-supplied is a bound parameter", () => {
  test("values never reach the SQL string", () => {
    const { sql, values } = compile(
      Predicate.and(
        Predicate.eq(FieldRef.property("plan"), "'; DROP TABLE events; --"),
        Predicate.contains(FieldRef.system("locale"), "en"),
      ),
    );
    expect(sql).not.toContain("DROP TABLE");
    expect(values.some((v) => String(v).includes("DROP TABLE"))).toBe(true);
  });

  test("property keys are parameters too, not interpolated identifiers", () => {
    const { sql, values } = compile(Predicate.contains(FieldRef.property("weird key"), "x"));
    expect(sql).not.toContain("weird key");
    expect(values).toContain("weird key");
  });

  test("placeholders are numbered in order", () => {
    const { sql } = compile(
      Predicate.and(
        Predicate.eq(FieldRef.system("os_name"), "macOS"),
        Predicate.eq(FieldRef.system("locale"), "en-GB"),
      ),
    );
    expect(sql).toContain("$1");
    expect(sql).toContain("$2");
  });
});

describe("LIKE metacharacters in user input are literals", () => {
  test("a search for a percent sign does not match everything", () => {
    const { values } = compile(Predicate.contains(FieldRef.system("app_version"), "100%"));
    expect(values[0]).toBe("%100\\%%");
  });

  test("underscores are escaped too", () => {
    expect(compile(Predicate.startsWith(FieldRef.system("app_version"), "v1_")).values[0]).toBe("v1\\_%");
  });
});

describe("composition", () => {
  test("and/or/not nest with explicit parentheses", () => {
    const { sql } = compile(
      Predicate.and(
        Predicate.eq(FieldRef.system("os_name"), "macOS"),
        Predicate.or(
          Predicate.gt(FieldRef.property("amount"), 10),
          Predicate.not(Predicate.exists(FieldRef.property("coupon"))),
        ),
      ),
    );
    expect(sql.startsWith("(")).toBe(true);
    expect(sql).toContain(" AND ");
    expect(sql).toContain(" OR ");
    expect(sql).toContain("NOT (");
  });

  test("existence on a property uses the key operator", () => {
    expect(compile(Predicate.exists(FieldRef.property("coupon"))).sql).toContain("properties ?");
  });

  test("notIn on a column also matches NULLs, which SQL's NOT IN does not", () => {
    // `x NOT IN (...)` is NULL when x is NULL, so those rows vanish. A user
    // asking "not pro" expects rows with no plan at all to be included.
    expect(compile(Predicate.notIn(FieldRef.system("os_name"), ["macOS"])).sql).toContain("IS NULL OR");
  });
});

describe("labels", () => {
  test("NULL and empty both read as unknown", () => {
    expect(fieldAsLabel(FieldRef.system("country_code"), new Params())).toContain("COALESCE(NULLIF(");
  });

  test("a property label extracts text — grouping is not filtering", () => {
    expect(fieldAsText(FieldRef.property("plan"), new Params())).toContain("properties ->>");
  });
});
