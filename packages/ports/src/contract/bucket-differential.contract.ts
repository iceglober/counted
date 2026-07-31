/**
 * The bucket differential contract.
 *
 * This is the most important suite in the package, because it pins the one
 * agreement that used to be a code comment.
 *
 * v1 bucketed three different ways — Timescale's `time_bucket` for
 * `query.timeBucket`, `date_trunc` for `groupBy:{type:"time"}` in the same
 * file, and a third JS implementation for the zero-fill axis, hand-aligned to
 * Monday with `(getUTCDay()+6)%7` because that happened to match
 * `time_bucket`'s `2000-01-03` origin. Nothing checked that the three agreed.
 * When they drifted, points landed in neighbouring buckets and the chart was
 * quietly wrong.
 *
 * v2 removes the second implementation: the domain computes edges and the
 * store is handed them. This suite proves the adapter actually honours that —
 * that an event at instant `t` is counted in the bucket `TimeAxis.assign`
 * says it belongs to, for every grain, across DST boundaries, month ends and
 * leap days.
 *
 * An adapter that fails this is misaligning charts, however green its own
 * unit tests are.
 */

import {
  Analysis,
  Instant,
  Measure,
  TimeAxis,
  Window,
  type Grain,
} from "@counted/domain";
import { RequestId } from "../driven/analytical-store";
import { anEvent, type StoreFixture } from "./fixtures";
import { check, equal, type ContractCase } from "./harness";

const GRAINS: readonly Grain[] = ["hour", "day", "week", "month"];

/** Deterministic PRNG — a failure is reproducible from the seed alone. */
const rng = (seed: number) => () => {
  seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
  return seed / 0x1_0000_0000;
};

const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));

/** Ask for a series over `axis` and return the dense per-bucket counts. */
const seriesFor = async (
  fixture: StoreFixture,
  window: Window,
  grain: Grain,
  now: Instant,
): Promise<readonly number[]> => {
  const axis = TimeAxis.build(window, grain, now);
  const id = RequestId("differential");
  const outcome = await fixture.store.executeBatch(
    [
      {
        id,
        kind: "series",
        project: fixture.project,
        analysis: Analysis.timeSeries(Measure.count(), window, grain),
        axis,
        bounds: { from: axis.edges[0]!, to: axis.edges[axis.edges.length - 1]! },
      },
    ],
    { deadlineMs: 30_000, traceId: "bucket-differential" },
  );

  const result = outcome.results.get(id);
  check(result !== undefined, "store returned no outcome for the series request");
  check(result!.ok, `series request failed: ${JSON.stringify(result)}`);
  const value = (result as { ok: true; value: { kind: string; values: readonly number[] } }).value;
  equal(value.kind, "series", "result kind");
  equal(
    value.values.length,
    TimeAxis.bucketCount(axis),
    "series must be dense and aligned to the requested axis",
  );
  return value.values;
};

/**
 * Seed one event per instant, ask for the series, and require every event to
 * appear in exactly the bucket the domain assigns it to.
 */
const assertAgreement = async (
  fixture: StoreFixture,
  instants: readonly Instant[],
  grain: Grain,
  window: Window,
  now: Instant,
  label: string,
): Promise<void> => {
  await fixture.reset();
  await fixture.writer.append(
    instants.map((t, i) =>
      anEvent(fixture.project, "tick", t, { idempotencyKey: `${label}-${i}` }),
    ),
    { deadlineMs: 30_000 },
  );

  const axis = TimeAxis.build(window, grain, now);
  const expected = new Array<number>(TimeAxis.bucketCount(axis)).fill(0);
  for (const t of instants) {
    const index = TimeAxis.assign(axis, t);
    check(index !== null, `${label}: seeded instant ${Instant.toISO(t)} fell outside the axis`);
    expected[index!] = (expected[index!] ?? 0) + 1;
  }

  const actual = await seriesFor(fixture, window, grain, now);

  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      const start = axis.edges[i]!;
      const end = axis.edges[i + 1]!;
      throw new Error(
        `${label} [${grain}] bucket ${i} (${Instant.toISO(start)} → ${Instant.toISO(end)}): ` +
          `domain says ${expected[i]}, store says ${actual[i]}. ` +
          `The store is not assigning rows to the edges it was given.`,
      );
    }
  }
};

export const bucketDifferentialContract: readonly ContractCase<StoreFixture>[] = [
  {
    name: "assigns rows to the edges it was given, at every grain",
    run: async (fixture) => {
      const now = iso("2026-03-17T14:37:00Z");
      const next = rng(20260317);

      for (const grain of GRAINS) {
        const window = Window.lastDays(grain === "hour" ? 2 : grain === "month" ? 400 : 60);
        const axis = TimeAxis.build(window, grain, now);
        const lo = Instant.toEpochMillis(axis.edges[0]!);
        const hi = Instant.toEpochMillis(axis.edges[axis.edges.length - 1]!);

        const instants = Array.from({ length: 60 }, () =>
          Instant.fromEpochMillis(lo + Math.floor(next() * (hi - lo))),
        );

        await assertAgreement(fixture, instants, grain, window, now, "random");
      }
    },
  },

  {
    name: "puts an instant exactly on an edge in the bucket that edge starts",
    run: async (fixture) => {
      // Half-open buckets. Off-by-one here is the classic way a daily chart
      // attributes midnight traffic to the wrong day.
      const now = iso("2026-03-17T14:37:00Z");
      const window = Window.lastDays(6);
      const axis = TimeAxis.build(window, "day", now);
      const starts = TimeAxis.bucketStarts(axis);

      const instants = starts.flatMap((s) => [
        s,
        Instant.fromEpochMillis(Instant.toEpochMillis(s) - 1),
        Instant.fromEpochMillis(Instant.toEpochMillis(s) + 1),
      ]);
      const inside = instants.filter((t) => TimeAxis.assign(axis, t) !== null);

      await assertAgreement(fixture, inside, "day", window, now, "edges");
    },
  },

  {
    name: "keeps month buckets on the calendar, including February and a leap day",
    run: async (fixture) => {
      // A fixed 30-day bucket cannot express this. v1 used one for trends.
      const now = iso("2028-06-15T00:00:00Z");
      const window = Window.between(iso("2028-01-01T00:00:00Z"), iso("2028-06-01T00:00:00Z"));

      const instants = [
        iso("2028-01-31T23:59:59Z"),
        iso("2028-02-01T00:00:00Z"),
        iso("2028-02-29T12:00:00Z"), // leap day
        iso("2028-03-01T00:00:00Z"),
        iso("2028-04-30T23:59:59Z"),
        iso("2028-05-01T00:00:00Z"),
      ];

      await assertAgreement(fixture, instants, "month", window, now, "calendar-months");
    },
  },

  {
    name: "aligns weeks to the axis, not to a storage engine's origin",
    run: async (fixture) => {
      // v1's JS truncation matched Timescale only because 2000-01-03 happens
      // to be a Monday. Here the axis simply is Monday-aligned and the store
      // must follow it.
      const now = iso("2026-03-17T14:37:00Z");
      const window = Window.lastDays(35);

      // All strictly before `now`, or they fall outside the axis — which the
      // suite catches, and did, the first time this file was run.
      const instants = [
        iso("2026-03-08T23:59:59Z"), // Sunday — belongs to the previous week
        iso("2026-03-09T00:00:00Z"), // Monday — starts a new one
        iso("2026-03-09T00:00:01Z"),
        iso("2026-03-15T23:59:59Z"), // Sunday again
        iso("2026-03-16T00:00:00Z"), // and the Monday after
      ];

      await assertAgreement(fixture, instants, "week", window, now, "week-alignment");
    },
  },

  {
    name: "does not shift buckets across a DST transition",
    run: async (fixture) => {
      // Everything is UTC, so a DST change in any local zone must not move a
      // boundary. This fails loudly if an adapter ever interprets timestamps
      // in the server's local time.
      const now = iso("2026-03-30T12:00:00Z");
      const window = Window.between(iso("2026-03-27T00:00:00Z"), iso("2026-03-31T00:00:00Z"));

      const instants = [
        iso("2026-03-29T00:30:00Z"), // inside the EU spring-forward window
        iso("2026-03-29T01:30:00Z"),
        iso("2026-03-29T02:30:00Z"),
        iso("2026-03-29T23:30:00Z"),
        iso("2026-03-30T00:30:00Z"),
      ];

      await assertAgreement(fixture, instants, "hour", window, now, "dst");
    },
  },

  {
    name: "returns zeros for empty buckets rather than omitting them",
    run: async (fixture) => {
      const now = iso("2026-03-17T14:37:00Z");
      const window = Window.lastDays(5);

      // One event only, in the middle of the window.
      await assertAgreement(fixture, [iso("2026-03-15T09:00:00Z")], "day", window, now, "sparse");

      const values = await seriesFor(fixture, window, "day", now);
      const nonZero = values.filter((v) => v > 0).length;
      equal(nonZero, 1, "exactly one bucket should be populated");
      check(
        values.length > 1 && values.some((v) => v === 0),
        "empty buckets must come back as zeros, not be omitted",
      );
    },
  },
];
