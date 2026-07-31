import { describe, expect, test } from "bun:test";
import { Instant } from "../shared";
import { Window } from "./window";
import {
  MAX_RETENTION_PERIODS,
  Retention,
  type CohortSize,
  type RetentionObservation,
} from "./retention";

const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));
const show = (i: Instant) => Instant.toISO(i);

const daily = (periods = 3) => Retention.of(Window.lastDays(30), "day", periods);
const monthly = (periods = 3) => Retention.of(Window.lastMonths(6), "month", periods);

describe("retention is person-scoped by construction", () => {
  test("basis is always person", () => {
    expect(daily().basis).toBe("person");
    expect(monthly().basis).toBe("person");
    // Retention.of({... basis: "visit"}) does not compile: `basis` is the
    // literal type "person" and is not part of the options object. Without an
    // identify() call there is no such thing as coming back.
  });
});

describe("validation", () => {
  const valid = (r: Retention) => {
    const x = Retention.validate(r);
    if (!x.ok) throw new Error(`expected valid, got ${JSON.stringify(x.error)}`);
    return x.value;
  };
  const invalid = (r: Retention) => {
    const x = Retention.validate(r);
    if (x.ok) throw new Error("expected invalid");
    return x.error;
  };

  test("periods must be positive and bounded", () => {
    expect(invalid(daily(0)).kind).toBe("NonPositivePeriods");
    expect(invalid(daily(-1)).kind).toBe("NonPositivePeriods");
    expect(invalid(daily(MAX_RETENTION_PERIODS + 1))).toMatchObject({
      kind: "TooManyPeriods",
      max: MAX_RETENTION_PERIODS,
    });
    valid(daily(MAX_RETENTION_PERIODS));
  });

  test("blank event names are refused", () => {
    expect(
      invalid(Retention.of(Window.lastDays(30), "day", 3, { startEvents: ["sign_up", " "] })).kind,
    ).toBe("EmptyEventName");
  });

  test("return events default to the joining events", () => {
    const r = Retention.of(Window.lastDays(30), "day", 3, { startEvents: ["sign_up"] });
    expect(Retention.returnEvents(r)).toEqual(["sign_up"]);

    const split = Retention.of(Window.lastDays(30), "day", 3, {
      startEvents: ["sign_up"],
      returnEvents: ["open_app"],
    });
    expect(Retention.returnEvents(split)).toEqual(["open_app"]);
  });
});

describe("offsets are calendar positions, not array indices", () => {
  test("a day offset walks days", () => {
    const r = daily(5);
    const start = iso("2026-03-01T00:00:00Z");
    expect(show(Retention.periodStartFor(r, start, 0))).toBe("2026-03-01T00:00:00.000Z");
    expect(show(Retention.periodStartFor(r, start, 3))).toBe("2026-03-04T00:00:00.000Z");
  });

  test("a month offset is a real month, across a February", () => {
    const r = monthly(4);
    const jan = iso("2026-01-01T00:00:00Z");
    expect(show(Retention.periodStartFor(r, jan, 1))).toBe("2026-02-01T00:00:00.000Z");
    expect(show(Retention.periodStartFor(r, jan, 2))).toBe("2026-03-01T00:00:00.000Z");
    expect(show(Retention.periodStartFor(r, jan, 3))).toBe("2026-04-01T00:00:00.000Z");
  });

  test("offsetOf inverts periodStartFor", () => {
    const r = daily(6);
    const start = iso("2026-03-01T00:00:00Z");
    for (let k = 0; k <= 6; k++) {
      expect(Retention.offsetOf(r, start, Retention.periodStartFor(r, start, k))).toBe(k);
    }
  });

  test("periods before the cohort, or past the reported width, have no offset", () => {
    const r = daily(3);
    const start = iso("2026-03-05T00:00:00Z");
    expect(Retention.offsetOf(r, start, iso("2026-03-04T00:00:00Z"))).toBeNull();
    expect(Retention.offsetOf(r, start, iso("2026-03-09T00:00:00Z"))).toBeNull();
  });

  test("a period with no activity anywhere does not shift later columns", () => {
    // The v1 bug in one test. Day +1 has zero activity project-wide. In v1 it
    // vanished from the sorted period list, so day +2's number was read into
    // the +1 column and everything after slid left by one.
    const r = daily(3);
    const cohort = iso("2026-03-01T00:00:00Z");
    const sizes: CohortSize[] = [{ cohortStart: cohort, size: 100 }];
    const observations: RetentionObservation[] = [
      { cohortStart: cohort, periodStart: iso("2026-03-01T00:00:00Z"), returned: 100 },
      // nothing at all on 2026-03-02 (+1)
      { cohortStart: cohort, periodStart: iso("2026-03-03T00:00:00Z"), returned: 30 },
      { cohortStart: cohort, periodStart: iso("2026-03-04T00:00:00Z"), returned: 20 },
    ];

    const grid = Retention.buildGrid(r, sizes, observations, iso("2026-03-10T00:00:00Z"));
    const cells = grid.cohorts[0]!.cells;

    expect(cells[0]).toMatchObject({ returned: 100, rate: 100 });
    expect(cells[1]).toMatchObject({ returned: 0, rate: 0 }); // stays put, as zero
    expect(cells[2]).toMatchObject({ returned: 30, rate: 30 }); // not shifted into +1
    expect(cells[3]).toMatchObject({ returned: 20, rate: 20 });
  });
});

describe("buildGrid", () => {
  const r = daily(3);
  const c1 = iso("2026-03-01T00:00:00Z");
  const c2 = iso("2026-03-02T00:00:00Z");

  test("every cohort gets the full width", () => {
    const grid = Retention.buildGrid(
      r,
      [{ cohortStart: c1, size: 10 }, { cohortStart: c2, size: 20 }],
      [],
      iso("2026-03-20T00:00:00Z"),
    );
    expect(grid.offsets).toEqual([0, 1, 2, 3]);
    for (const cohort of grid.cohorts) expect(cohort.cells).toHaveLength(4);
  });

  test("cohorts come back in chronological order", () => {
    const grid = Retention.buildGrid(
      r,
      [{ cohortStart: c2, size: 20 }, { cohortStart: c1, size: 10 }],
      [],
      iso("2026-03-20T00:00:00Z"),
    );
    expect(grid.cohorts.map((c) => show(c.start))).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
    ]);
  });

  test("a period that has not begun is null, not zero", () => {
    // Cohort started yesterday; +2 and +3 are in the future.
    const grid = Retention.buildGrid(
      r,
      [{ cohortStart: iso("2026-03-09T00:00:00Z"), size: 50 }],
      [{ cohortStart: iso("2026-03-09T00:00:00Z"), periodStart: iso("2026-03-09T00:00:00Z"), returned: 50 }],
      iso("2026-03-10T12:00:00Z"),
    );
    const cells = grid.cohorts[0]!.cells;
    expect(cells[0]).toMatchObject({ returned: 50 });
    expect(cells[1]).toMatchObject({ returned: 0 }); // today has begun, nobody back yet
    expect(cells[2]).toBeNull(); // tomorrow — unknowable
    expect(cells[3]).toBeNull();
  });

  test("an elapsed period with no returns is a real zero", () => {
    const grid = Retention.buildGrid(
      r,
      [{ cohortStart: c1, size: 50 }],
      [{ cohortStart: c1, periodStart: c1, returned: 50 }],
      iso("2026-03-20T00:00:00Z"),
    );
    expect(grid.cohorts[0]!.cells[3]).toMatchObject({ returned: 0, rate: 0 });
  });

  test("rates are percentages of the cohort size", () => {
    const grid = Retention.buildGrid(
      r,
      [{ cohortStart: c1, size: 200 }],
      [
        { cohortStart: c1, periodStart: c1, returned: 200 },
        { cohortStart: c1, periodStart: iso("2026-03-02T00:00:00Z"), returned: 50 },
      ],
      iso("2026-03-20T00:00:00Z"),
    );
    expect(grid.cohorts[0]!.cells[0]!.rate).toBe(100);
    expect(grid.cohorts[0]!.cells[1]!.rate).toBe(25);
  });

  test("an empty cohort gives zero rates, not NaN", () => {
    const grid = Retention.buildGrid(
      r,
      [{ cohortStart: c1, size: 0 }],
      [],
      iso("2026-03-20T00:00:00Z"),
    );
    expect(grid.cohorts[0]!.cells.every((c) => c === null || Number.isFinite(c.rate))).toBe(true);
    expect(grid.cohorts[0]!.cells[0]!.rate).toBe(0);
  });

  test("observations outside the reported width are ignored, not misfiled", () => {
    const grid = Retention.buildGrid(
      r,
      [{ cohortStart: c1, size: 10 }],
      [
        { cohortStart: c1, periodStart: iso("2026-02-28T00:00:00Z"), returned: 99 }, // before
        { cohortStart: c1, periodStart: iso("2026-03-09T00:00:00Z"), returned: 99 }, // past +3
      ],
      iso("2026-03-20T00:00:00Z"),
    );
    expect(grid.cohorts[0]!.cells.every((c) => c !== null && c.returned === 0)).toBe(true);
  });

  test("duplicate observations for one cell are summed", () => {
    const grid = Retention.buildGrid(
      r,
      [{ cohortStart: c1, size: 10 }],
      [
        { cohortStart: c1, periodStart: c1, returned: 4 },
        { cohortStart: c1, periodStart: c1, returned: 6 },
      ],
      iso("2026-03-20T00:00:00Z"),
    );
    expect(grid.cohorts[0]!.cells[0]).toMatchObject({ returned: 10, rate: 100 });
  });

  test("monthly cohorts land on real month boundaries", () => {
    const rm = monthly(2);
    const jan = iso("2026-01-01T00:00:00Z");
    const grid = Retention.buildGrid(
      rm,
      [{ cohortStart: jan, size: 100 }],
      [
        { cohortStart: jan, periodStart: jan, returned: 100 },
        { cohortStart: jan, periodStart: iso("2026-02-01T00:00:00Z"), returned: 40 },
        { cohortStart: jan, periodStart: iso("2026-03-01T00:00:00Z"), returned: 25 },
      ],
      iso("2026-06-01T00:00:00Z"),
    );
    expect(grid.cohorts[0]!.cells.map((c) => c?.returned)).toEqual([100, 40, 25]);
  });
});

describe("averageRateAt", () => {
  const r = daily(2);
  const c1 = iso("2026-03-01T00:00:00Z");
  const c2 = iso("2026-03-02T00:00:00Z");

  test("averages only the cohorts that can answer", () => {
    const grid = Retention.buildGrid(
      r,
      [{ cohortStart: c1, size: 100 }, { cohortStart: c2, size: 100 }],
      [
        { cohortStart: c1, periodStart: iso("2026-03-02T00:00:00Z"), returned: 40 },
        { cohortStart: c2, periodStart: iso("2026-03-03T00:00:00Z"), returned: 60 },
      ],
      iso("2026-03-20T00:00:00Z"),
    );
    expect(Retention.averageRateAt(grid, 1)).toBeCloseTo(50, 6);
  });

  test("unknowable cells are skipped, not counted as zero", () => {
    // c2's +2 has not happened yet, so the average at +2 comes from c1 alone.
    const grid = Retention.buildGrid(
      r,
      [{ cohortStart: c1, size: 100 }, { cohortStart: c2, size: 100 }],
      [{ cohortStart: c1, periodStart: iso("2026-03-03T00:00:00Z"), returned: 30 }],
      iso("2026-03-03T12:00:00Z"),
    );
    expect(grid.cohorts[1]!.cells[2]).toBeNull();
    expect(Retention.averageRateAt(grid, 2)).toBeCloseTo(30, 6);
  });

  test("an offset nobody can answer gives null, not zero", () => {
    const grid = Retention.buildGrid(
      r,
      [{ cohortStart: iso("2026-03-10T00:00:00Z"), size: 10 }],
      [],
      iso("2026-03-10T06:00:00Z"),
    );
    expect(Retention.averageRateAt(grid, 2)).toBeNull();
  });
});
