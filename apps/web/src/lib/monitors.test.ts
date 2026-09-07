import { describe, expect, test } from "bun:test";
import {
  channelLines,
  channels,
  compose,
  cooldown,
  describeAnalysis,
  describeThreshold,
  retargetAnalysis,
  threshold,
  type MonitorDraft,
} from "./monitors";

const draft = (overrides: Partial<MonitorDraft> = {}): MonitorDraft => ({
  measure: "events",
  event: undefined,
  windowAmount: 1,
  windowUnit: "hour",
  summary: "total",
  comparison: "above",
  value: 100,
  cooldownAmount: null,
  cooldownUnit: "hour",
  channels: "",
  ...overrides,
});

const composed = (overrides: Partial<MonitorDraft> = {}) => {
  const built = compose(draft(overrides));
  if (!built.ok) throw new Error(`expected a monitor, got: ${built.problem}`);
  return built.value;
};

test("retargeting event selection and window retains custom property filters and summary", () => {
  const property = { op: "eq", field: { source: "property", key: "url" }, value: "/pricing" } as const;
  const updated = retargetAnalysis({
    ...composed().analysis,
    where: { op: "and", operands: [
      { op: "eq", field: { source: "dimension", key: "event_type" }, value: "page_view" }, property,
    ] },
  }, { ...draft(), events: ["purchase", "signup"], windowAmount: 7, windowUnit: "day", summary: "peak" });
  expect(updated).toMatchObject({ ok: true, value: {
    summary: "peak", window: { kind: "relative", amount: 7, unit: "day" },
    where: { op: "and", operands: [
      { op: "in", field: { source: "dimension", key: "event_type" }, values: ["purchase", "signup"] }, property,
    ] },
  } });
});

describe("the analysis is always a scalar", () => {
  test("the form has no shape to choose, so the shape is scalar", () => {
    // The API refuses a series with `AnalysisMustBeScalar`; this form cannot
    // reach that refusal because it never offers anything else.
    const built = composed({ measure: "visits", summary: "peak" });
    expect(built.analysis.shape).toBe("scalar");
    expect(built.analysis.measure).toEqual({ kind: "unique", basis: "visit" });
    expect(built.analysis.summary).toBe("peak");
  });

  test("the window stays relative", () => {
    // "The last hour" has to still mean that at every evaluation.
    expect(composed({ windowAmount: 6, windowUnit: "hour" }).analysis.window).toEqual({
      kind: "relative",
      amount: 6,
      unit: "hour",
    });
  });

  test("an event name becomes the one predicate, and no name leaves it off", () => {
    expect(composed({ event: "checkout_failed" }).analysis.where).toEqual({
      op: "eq",
      field: { source: "dimension", key: "event_type" },
      value: "checkout_failed",
    });
    expect("where" in composed().analysis).toBe(false);
  });

  test("an unknown summary, measure or window is refused in words", () => {
    expect(compose(draft({ summary: "median" })).ok).toBe(false);
    expect(compose(draft({ measure: "" })).ok).toBe(false);
    expect(compose(draft({ windowAmount: 0 })).ok).toBe(false);
    expect(compose(draft({ windowUnit: "fortnight" })).ok).toBe(false);
  });
});

describe("the threshold", () => {
  test("carries the comparison and the exact number", () => {
    expect(composed({ comparison: "below", value: 0.5 }).threshold).toEqual({
      comparison: "below",
      value: 0.5,
    });
  });

  test("a missing value or an unknown comparison is refused", () => {
    // `null` is what an empty field parses to; it must not become zero.
    expect(threshold("above", null).ok).toBe(false);
    expect(threshold("near", 10).ok).toBe(false);
  });
});

describe("the cooldown", () => {
  test("blank is not stated, and is left off the request", () => {
    // The domain has a default on create and keeps the current value on
    // update; sending zero would mean "announce every evaluation".
    expect(cooldown(null, "hour")).toEqual({ ok: true, value: undefined });
    expect("cooldownMs" in composed()).toBe(false);
  });

  test("a count of units becomes milliseconds", () => {
    expect(cooldown(5, "minute")).toEqual({ ok: true, value: 300_000 });
    expect(composed({ cooldownAmount: 2, cooldownUnit: "day" }).cooldownMs).toBe(172_800_000);
  });

  test("zero is a real cooldown and negative or fractional counts are refused", () => {
    expect(cooldown(0, "minute")).toEqual({ ok: true, value: 0 });
    expect(cooldown(-1, "minute").ok).toBe(false);
    expect(cooldown(1.5, "hour").ok).toBe(false);
    expect(cooldown(1, "week").ok).toBe(false);
  });
});

describe("channels", () => {
  test("one per line, sorted into email and webhook by what the line looks like", () => {
    const parsed = channels("ops@example.com\r\n\n  https://example.com/hooks/counted \n");
    expect(parsed).toEqual({
      ok: true,
      value: [
        { kind: "email", address: "ops@example.com" },
        { kind: "webhook", url: "https://example.com/hooks/counted" },
      ],
    });
  });

  test("an empty box is an empty list, not a refusal", () => {
    // A monitor that announces nowhere still evaluates and still shows its
    // state on the page.
    expect(channels("   \n")).toEqual({ ok: true, value: [] });
  });

  test("a line that is neither is refused by name", () => {
    const parsed = channels("ops@example.com\nslack: #alerts");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("unreachable");
    expect(parsed.problem).toContain("slack: #alerts");
  });

  test("a non-http scheme is not a webhook", () => {
    expect(channels("ftp://example.com/x").ok).toBe(false);
  });

  test("the textarea round-trips", () => {
    const parsed = channels("a@example.com\nhttps://example.com/h");
    if (!parsed.ok) throw new Error("unreachable");
    expect(channelLines(parsed.value)).toBe("a@example.com\nhttps://example.com/h");
  });
});

describe("reading a monitor back", () => {
  test("a scalar is one plain phrase", () => {
    expect(describeAnalysis(composed({ windowAmount: 7, windowUnit: "day" }).analysis)).toBe(
      "total events, last 7 days",
    );
    expect(
      describeAnalysis(
        composed({ measure: "visits", summary: "peak", event: "purchase" }).analysis,
      ),
    ).toBe("peak unique visits where the event is “purchase”, last 1 hour");
  });

  test("a non-scalar on the wire is named, not smoothed over", () => {
    expect(
      describeAnalysis({
        shape: "series",
        measure: { kind: "count" },
        window: { kind: "relative", amount: 1, unit: "day" },
        grain: "hour",
      }),
    ).toBe("a series — not one number");
  });

  test("a threshold is exact, and grouped only when whole", () => {
    // `measured` would round 0.25 to 0.3, and the page would then disagree
    // with the rule it describes.
    expect(describeThreshold({ comparison: "above", value: 1000 })).toBe("above 1,000");
    expect(describeThreshold({ comparison: "below", value: 0.25 })).toBe("below 0.25");
  });
});
