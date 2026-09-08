import { describe, expect, test } from "bun:test";
import { Duration, Instant, ProjectId, WorkspaceId } from "@counted/kernel";
import type { BreakdownQuery, EngineScope, SeriesQuery } from "@counted/analytics-ports";

import { planBreakdown, planFilters, planFunnel, planSeries, planSums } from "./plan";

const at = (iso: string): Instant => {
  const parsed = Instant.fromISO(iso);
  if (!parsed.ok) throw new Error(`bad fixture instant: ${iso}`);
  return parsed.value;
};

const PROJECT: EngineScope = { level: "project", project: ProjectId("prj_1") };
const NOW = at("2024-06-01T00:00:00Z");

const series = (over: Partial<SeriesQuery> = {}): SeriesQuery => ({
  scope: PROJECT,
  bounds: { from: at("2024-05-01T00:00:00Z"), to: at("2024-06-01T00:00:00Z") },
  step: "day",
  ...over,
});

const refusal = (outcome: ReturnType<typeof planSeries>): string => {
  if (outcome.ok) throw new Error("expected a refusal, got a plan");
  if (outcome.error.kind !== "InvalidQuery") throw new Error(`expected InvalidQuery, got ${outcome.error.kind}`);
  return outcome.error.detail;
};

describe("filters", () => {
  test("event unions reach one engine read, including for uniques", () => {
    for (const additive of [true, false]) {
      const outcome = planSeries(series({ event: ["view", "buy"], filters: { country: "US" } }), NOW, { additive });
      if (!outcome.ok) throw new Error(outcome.error.kind);
      expect(outcome.plan.calls).toHaveLength(1);
      expect(outcome.plan.calls[0]?.query.filters).toEqual({ event_type: ["view", "buy"], country: "US" });
    }
  });
  test("country is an ordinary filter now — the edge derives it, so a column carries it", () => {
    // This used to be the standing example of a refusal: `country` was
    // `planned`, no column carried it, and the honest answer was "not
    // collected yet". Ingestion derives it from the request address now and
    // throws the address away, so it filters like any other dimension. The
    // refusal path itself is still covered — by `answerability.test.ts`, over a
    // catalog built to lack a column, which is a state a project can be in.
    const outcome = planSeries(series({ filters: { country: "US" } }), NOW, { additive: true });
    if (!outcome.ok) throw new Error(`expected a plan, got ${outcome.error.kind}`);
    expect(outcome.plan.calls[0]?.query.filters).toEqual({ country: "US" });
  });

  test("country and an SDK dimension combine into one filter map", () => {
    const outcome = planFilters(undefined, { country: "DE", os_name: "android" });
    if (!outcome.ok) throw new Error(outcome.error.kind);
    expect(outcome.plan).toEqual({ country: "DE", os_name: "android" });
  });

  test("a filter on a customer property is refused by name, because props are not a filter column", () => {
    // The engine filters on declared dimension columns; a customer property
    // lives in the props blob. The honest answer is the reason, not a scan.
    const detail = refusal(planSeries(series({ filters: { plan_tier: "pro" } }), NOW, { additive: true }));
    expect(detail).toContain("plan_tier");
    expect(detail).toContain("not a declared dimension");
  });

  test("an event restriction is just a predicate on event_type, merged with the rest", () => {
    const outcome = planFilters("purchase", { os_name: "iOS" });
    if (!outcome.ok) throw new Error(outcome.error.kind);
    expect(outcome.plan).toEqual({ os_name: "iOS", event_type: "purchase" });
  });

  test("naming the event twice is a conflict, not a silent last-one-wins", () => {
    const outcome = planFilters("purchase", { event_type: "signup" });
    expect(outcome.ok).toBe(false);
  });
});

describe("alignment", () => {
  test("the range start is floored, because litics anchors its buckets on it", () => {
    // litics bins from the hour containing `from`. A 10:30 start on a daily
    // step would label every bucket with the day before the data it holds.
    const outcome = planSeries(
      series({ bounds: { from: at("2024-05-01T10:30:00Z"), to: at("2024-05-04T00:00:00Z") } }),
      NOW,
      { additive: true },
    );
    if (!outcome.ok) throw new Error("expected a plan");
    expect(outcome.plan.calls[0]?.query.from).toBe("2024-05-01T00:00:00.000Z");
    expect(outcome.plan.starts).toHaveLength(3);
  });
});

describe("reach", () => {
  test("a window older than retention is refused, not truncated", () => {
    // The compactor deletes segments older than 760 days. The read would
    // succeed, return two years of rows, and draw a chart that appears to show
    // traffic starting one spring.
    const detail = refusal(
      planSeries(
        series({
          step: "day",
          bounds: { from: at("2021-01-01T00:00:00Z"), to: at("2024-06-01T00:00:00Z") },
        }),
        NOW,
        { additive: true },
      ),
    );
    expect(detail).toContain("760 days");
  });

  test("an hourly grid over a year is a slower read, not a refused one", () => {
    // There is no cube to outgrow: every step is answered from summaries and
    // segments, so granularity never changes what can be asked.
    const outcome = planSeries(
      series({
        step: "hour",
        filters: { os_name: "iOS" },
        bounds: { from: at("2023-06-01T00:00:00Z"), to: at("2024-06-01T00:00:00Z") },
      }),
      NOW,
      { additive: true },
    );
    expect(outcome.ok).toBe(true);
  });
});

describe("months", () => {
  const monthly = series({
    step: "month",
    bounds: { from: at("2024-01-15T00:00:00Z"), to: at("2024-03-10T00:00:00Z") },
  });

  test("an additive measure is one daily statement folded into months", () => {
    const outcome = planSeries(monthly, NOW, { additive: true });
    if (!outcome.ok) throw new Error("expected a plan");
    expect(outcome.plan.calls).toHaveLength(1);
    expect(outcome.plan.calls[0]?.query.step).toBe("1 day");
    expect(outcome.plan.starts).toHaveLength(3);
  });

  test("uniques are one read per calendar month, because cardinalities do not add", () => {
    // Summing three months of unique counts counts a visitor once per month
    // they appeared. The actor sets merge inside one read, so each month is
    // its own read with a stride as long as the month itself.
    const outcome = planSeries(monthly, NOW, { additive: false });
    if (!outcome.ok) throw new Error("expected a plan");
    expect(outcome.plan.calls.map((c) => c.query.step)).toEqual(["31 days", "29 days", "31 days"]);
    expect(outcome.plan.calls.map((c) => c.query.from)).toEqual([
      "2024-01-01T00:00:00.000Z",
      "2024-02-01T00:00:00.000Z",
      "2024-03-01T00:00:00.000Z",
    ]);
  });

  test("a month stride is a whole number of days, which the engine answers from hourly summaries", () => {
    const outcome = planSeries(monthly, NOW, { additive: false });
    if (!outcome.ok) throw new Error("expected a plan");
    for (const call of outcome.plan.calls) expect(call.query.step).toMatch(/^\d+ days$/);
  });
});

describe("bounds", () => {
  test("a window that ends before it starts is refused rather than producing no buckets", () => {
    const detail = refusal(
      planSeries(
        series({ bounds: { from: at("2024-05-04T00:00:00Z"), to: at("2024-05-01T00:00:00Z") } }),
        NOW,
        { additive: true },
      ),
    );
    expect(detail).toContain("ends at or before it starts");
  });
});

describe("sums", () => {
  test("a measure nothing declares is refused by name, not answered with zeroes", () => {
    const outcome = planSums({ ...series(), measure: "revenue_cents" }, NOW);
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.error.kind).toBe("InvalidQuery");
    if (outcome.error.kind !== "InvalidQuery") return;
    expect(outcome.error.detail).toContain("revenue_cents");
  });
});

describe("breakdowns", () => {
  const breakdown = (over: Partial<BreakdownQuery> = {}): BreakdownQuery => ({
    ...series(),
    by: "os_name",
    order: "desc",
    limit: 10,
    ...over,
  });

  const breakdownRefusal = (outcome: ReturnType<typeof planBreakdown>): string => {
    if (outcome.ok) throw new Error("expected a refusal, got a plan");
    if (outcome.error.kind !== "InvalidQuery") throw new Error(outcome.error.kind);
    return outcome.error.detail;
  };

  test("the whole window becomes one bin, on the step's own grid", () => {
    // A breakdown has no buckets: one number per value, over the window. The
    // stride is how you ask litics for a single bucket.
    const outcome = planBreakdown(
      breakdown({ bounds: { from: at("2024-05-01T00:00:00Z"), to: at("2024-06-01T00:00:00Z") } }),
      NOW,
    );
    if (!outcome.ok) throw new Error("expected a plan");
    expect(outcome.plan.call.query.step).toBe("31 days");
    expect(outcome.plan.call.query.from).toBe("2024-05-01T00:00:00.000Z");
    expect(outcome.plan.call.query.groupBy).toEqual(["os_name"]);
  });

  test("the origin is floored onto the grid and never past it", () => {
    // Floor further than the step and the answer quietly includes hours
    // nobody asked for; do not floor at all and every bucket is mislabelled.
    const outcome = planBreakdown(
      breakdown({
        step: "hour",
        bounds: { from: at("2024-05-30T10:30:00Z"), to: at("2024-05-30T13:00:00Z") },
      }),
      NOW,
    );
    if (!outcome.ok) throw new Error("expected a plan");
    expect(outcome.plan.call.query.from).toBe("2024-05-30T10:00:00.000Z");
    expect(outcome.plan.call.query.step).toBe("3 hours");
  });

  test("a partial day still rounds up to a whole one, because the bin only has to cover the window", () => {
    // The stride decides binning; the WHERE clause decides the range. A
    // stride longer than the window reads nothing extra.
    const outcome = planBreakdown(
      breakdown({ bounds: { from: at("2024-05-30T00:00:00Z"), to: at("2024-05-31T06:00:00Z") } }),
      NOW,
    );
    if (!outcome.ok) throw new Error("expected a plan");
    expect(outcome.plan.call.query.step).toBe("2 days");
    expect(outcome.plan.call.query.to).toBe("2024-05-31T06:00:00.000Z");
  });

  test("a window that does not start at midnight gets a stride one hour longer than a day", () => {
    // 24 hours of window, 25 hours of stride: the bin only has to cover the
    // window, and it reads nothing extra.
    const outcome = planBreakdown(
      breakdown({
        step: "hour",
        bounds: { from: at("2024-05-30T10:00:00Z"), to: at("2024-05-31T10:00:00Z") },
      }),
      NOW,
    );
    if (!outcome.ok) throw new Error("expected a plan");
    expect(outcome.plan.call.query.step).toBe("25 hours");
    expect(outcome.plan.call.query.to).toBe("2024-05-31T10:00:00.000Z");
  });

  test("an hourly grid over five months is answerable; retention is the only reach", () => {
    const outcome = planBreakdown(
      breakdown({
        step: "hour",
        bounds: { from: at("2024-01-01T06:00:00Z"), to: at("2024-06-01T06:00:00Z") },
      }),
      NOW,
    );
    expect(outcome.ok).toBe(true);
  });

  test("a window past retention is refused, not truncated", () => {
    const detail = breakdownRefusal(
      planBreakdown(
        breakdown({ bounds: { from: at("2021-01-01T00:00:00Z"), to: at("2024-06-01T00:00:00Z") } }),
        NOW,
      ),
    );
    expect(detail).toContain("760 days");
  });

  test("a breakdown by country groups on its column", () => {
    // The most-asked-for slice. It is one grouped read rather than one read
    // per value.
    const outcome = planBreakdown(breakdown({ by: "country" }), NOW);
    if (!outcome.ok) throw new Error(`expected a plan, got ${outcome.error.kind}`);
    expect(outcome.plan.call.query.groupBy).toEqual(["country"]);
  });

  test("a breakdown by a customer property is refused by name, because no column carries it", () => {
    // Summary rows hold one row per combination of the declared dimensions —
    // a customer property was never separated out when they were written.
    const detail = breakdownRefusal(planBreakdown(breakdown({ by: "plan_tier" }), NOW));
    expect(detail).toContain("plan_tier");
    expect(detail).toContain("not a declared dimension");
  });

  test("a filter and a group-by combine: pin one dimension, split by another", () => {
    const outcome = planBreakdown(
      breakdown({ by: "locale", filters: { os_name: "iOS" } }),
      NOW,
    );
    if (!outcome.ok) throw new Error("expected a plan");
    expect(outcome.plan.call.query.filters).toEqual({ os_name: "iOS" });
    expect(outcome.plan.call.query.groupBy).toEqual(["locale"]);
  });

  test("a limit below one is refused rather than returning nothing", () => {
    expect(breakdownRefusal(planBreakdown(breakdown({ limit: 0 }), NOW))).toContain("at least 1");
  });

  test("a measure nothing declares is refused before routing", () => {
    const detail = breakdownRefusal(
      planBreakdown(breakdown(), NOW, { measure: "revenue_cents" }),
    );
    expect(detail).toContain("revenue_cents");
  });

  test("an inverted window is refused, as it is for a series", () => {
    const detail = breakdownRefusal(
      planBreakdown(
        breakdown({ bounds: { from: at("2024-06-01T00:00:00Z"), to: at("2024-05-01T00:00:00Z") } }),
        NOW,
      ),
    );
    expect(detail).toContain("ends at or before it starts");
  });
});

describe("funnels", () => {
  const steps = ["view", "add_to_cart", "purchase"] as const;

  test("a funnel inside the cap plans one read", () => {
    const outcome = planFunnel(
      {
        scope: { level: "workspace", workspace: WorkspaceId("ws_1") },
        bounds: { from: at("2024-05-01T00:00:00Z"), to: at("2024-06-01T00:00:00Z") },
        steps,
        within: Duration.days(3),
      },
      NOW,
    );
    if (!outcome.ok) throw new Error("expected a plan");
    expect(outcome.plan.query.within).toBe("259200 seconds");
    expect(outcome.plan.query.scope).toBe("ws_1");
  });

  test("a funnel longer than the cap is refused, because it would decode a year of segments", () => {
    const outcome = planFunnel(
      {
        scope: PROJECT,
        bounds: { from: at("2023-06-01T00:00:00Z"), to: at("2024-06-01T00:00:00Z") },
        steps,
      },
      NOW,
    );
    if (outcome.ok) throw new Error("expected a refusal");
    if (outcome.error.kind !== "InvalidQuery") throw new Error(outcome.error.kind);
    expect(outcome.error.detail).toContain("95 days");
  });

  test("a funnel older than retention is refused before its length is even considered", () => {
    const outcome = planFunnel(
      {
        scope: PROJECT,
        bounds: { from: at("2021-01-01T00:00:00Z"), to: at("2021-02-01T00:00:00Z") },
        steps,
      },
      NOW,
    );
    if (outcome.ok) throw new Error("expected a refusal");
    if (outcome.error.kind !== "InvalidQuery") throw new Error(outcome.error.kind);
    expect(outcome.error.detail).toContain("760 days");
  });

  test("a blank step name is refused before it reaches SQL", () => {
    const outcome = planFunnel(
      {
        scope: PROJECT,
        bounds: { from: at("2024-05-01T00:00:00Z"), to: at("2024-06-01T00:00:00Z") },
        steps: ["view", "  ", "purchase"],
      },
      NOW,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("scope", () => {
  test("a workspace scope binds the workspace id, which the closure table expands to its projects", () => {
    const outcome = planSeries(
      series({ scope: { level: "workspace", workspace: WorkspaceId("ws_1") } }),
      NOW,
      { additive: true },
    );
    if (!outcome.ok) throw new Error("expected a plan");
    expect(outcome.plan.calls[0]?.query.scope).toBe("ws_1");
  });
});
