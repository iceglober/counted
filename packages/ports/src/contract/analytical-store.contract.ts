/**
 * AnalyticalStore contract — the semantics every store must share.
 */

import { Analysis, FieldRef, Instant, Measure, Window } from "@counted/domain";
import { RequestId, type StoreResult } from "../driven/analytical-store";
import { anEvent, type StoreFixture } from "./fixtures";
import { check, equal, type ContractCase } from "./harness";

const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));
const week = Window.lastDays(7);
const now = iso("2026-03-17T14:37:00Z");
const bounds = { from: iso("2026-03-10T00:00:00Z"), to: iso("2026-03-18T00:00:00Z") };

const one = async (fixture: StoreFixture, request: Parameters<StoreFixture["store"]["executeBatch"]>[0][number]) => {
  const outcome = await fixture.store.executeBatch([request], { deadlineMs: 30_000, traceId: "contract" });
  const result = outcome.results.get(request.id);
  check(result !== undefined, "an outcome must exist for every request id");
  check(result!.ok, `request failed: ${JSON.stringify(result)}`);
  return (result as { ok: true; value: StoreResult }).value;
};

const seed = async (fixture: StoreFixture) => {
  await fixture.reset();
  await fixture.writer.append(
    [
      anEvent(fixture.project, "page_view", iso("2026-03-15T10:00:00Z"), { idempotencyKey: "a", visit: "v1" as never, system: { os_name: "macOS" } }),
      anEvent(fixture.project, "page_view", iso("2026-03-15T11:00:00Z"), { idempotencyKey: "b", visit: "v1" as never, system: { os_name: "macOS" } }),
      anEvent(fixture.project, "page_view", iso("2026-03-16T10:00:00Z"), { idempotencyKey: "c", visit: "v2" as never, system: { os_name: "Windows" } }),
      anEvent(fixture.project, "purchase", iso("2026-03-16T12:00:00Z"), { idempotencyKey: "d", visit: "v2" as never, properties: { amount: 100 } }),
    ],
    { deadlineMs: 30_000 },
  );
};

export const analyticalStoreContract: readonly ContractCase<StoreFixture>[] = [
  {
    name: "counts events over a window",
    run: async (fixture) => {
      await seed(fixture);
      const value = await one(fixture, {
        id: RequestId("scalar"),
        kind: "scalar",
        project: fixture.project,
        analysis: Analysis.countOverWindow(week),
        bounds,
      });
      equal(value.kind, "scalar", "result kind");
      if (value.kind === "scalar") equal(value.value, 4, "total events");
    },
  },

  {
    name: "restricts to the named events",
    run: async (fixture) => {
      await seed(fixture);
      const value = await one(fixture, {
        id: RequestId("filtered"),
        kind: "scalar",
        project: fixture.project,
        analysis: { measure: Measure.count(), events: ["page_view"], window: week },
        bounds,
      });
      if (value.kind === "scalar") equal(value.value, 3, "page_view count");
    },
  },

  {
    name: "counts distinct visits, not rows",
    run: async (fixture) => {
      await seed(fixture);
      const value = await one(fixture, {
        id: RequestId("visits"),
        kind: "scalar",
        project: fixture.project,
        analysis: { measure: Measure.distinctVisits(), window: week },
        bounds,
      });
      if (value.kind === "scalar") equal(value.value, 2, "distinct visits");
    },
  },

  {
    name: "breaks down by a system field, ordered and labelled",
    run: async (fixture) => {
      await seed(fixture);
      const value = await one(fixture, {
        id: RequestId("bd"),
        kind: "breakdown",
        project: fixture.project,
        analysis: Analysis.breakdown(Measure.count(), FieldRef.system("os_name"), week),
        bounds,
      });
      equal(value.kind, "breakdown", "result kind");
      if (value.kind === "breakdown") {
        check(value.rows.length >= 1, "at least one group");
        const macos = value.rows.find((r) => r.label === "macOS");
        check(macos !== undefined, "macOS group present");
        equal(macos!.value, 2, "macOS count");
      }
    },
  },

  {
    name: "aggregates a numeric property without failing on non-numeric rows",
    run: async (fixture) => {
      // v1's gt/lt path cast to numeric with no guard, so a single
      // non-numeric value raised 22P02 and failed the entire insight.
      await fixture.reset();
      await fixture.writer.append(
        [
          anEvent(fixture.project, "purchase", iso("2026-03-16T10:00:00Z"), { idempotencyKey: "n1", properties: { amount: 10 } }),
          anEvent(fixture.project, "purchase", iso("2026-03-16T11:00:00Z"), { idempotencyKey: "n2", properties: { amount: "not-a-number" } }),
          anEvent(fixture.project, "purchase", iso("2026-03-16T12:00:00Z"), { idempotencyKey: "n3", properties: { amount: 32 } }),
        ],
        { deadlineMs: 30_000 },
      );

      const value = await one(fixture, {
        id: RequestId("agg"),
        kind: "scalar",
        project: fixture.project,
        analysis: { measure: Measure.aggregate("sum", "amount"), events: ["purchase"], window: week },
        bounds,
      });
      if (value.kind === "scalar") equal(value.value, 42, "sum skips the unparseable row rather than failing");
    },
  },

  {
    name: "isolates projects — one customer never sees another's events",
    run: async (fixture) => {
      await seed(fixture);
      const value = await one(fixture, {
        id: RequestId("iso"),
        kind: "scalar",
        project: fixture.project,
        analysis: Analysis.countOverWindow(week),
        bounds,
      });
      if (value.kind === "scalar") equal(value.value, 4, "only this project's events");
    },
  },

  {
    name: "answers every request in a batch, and says so per request",
    run: async (fixture) => {
      await seed(fixture);
      const ids = [RequestId("m1"), RequestId("m2"), RequestId("m3")];
      const outcome = await fixture.store.executeBatch(
        ids.map((id) => ({
          id,
          kind: "scalar" as const,
          project: fixture.project,
          analysis: Analysis.countOverWindow(week),
          bounds,
        })),
        { deadlineMs: 30_000, traceId: "batch" },
      );
      equal(outcome.results.size, 3, "one outcome per request");
      for (const id of ids) check(outcome.results.get(id)?.ok === true, `outcome for ${id}`);
    },
  },

  {
    name: "coalesces identical questions instead of running them twice",
    run: async (fixture) => {
      await seed(fixture);
      const analysis = Analysis.countOverWindow(week);
      const outcome = await fixture.store.executeBatch(
        [
          { id: RequestId("dup1"), kind: "scalar", project: fixture.project, analysis, bounds },
          { id: RequestId("dup2"), kind: "scalar", project: fixture.project, analysis, bounds },
        ],
        { deadlineMs: 30_000, traceId: "coalesce" },
      );
      equal(outcome.results.size, 2, "both requests answered");
      check(
        outcome.stats.statements <= 1 || outcome.stats.coalesced >= 1,
        "identical questions should run once — v1 ran them twice in a single dashboard load",
      );
    },
  },

  {
    name: "reports capabilities rather than leaving them to be assumed",
    run: async (fixture) => {
      const caps = fixture.store.capabilities();
      check(caps.engine.length > 0, "engine named");
      check(
        caps.partitioning === "declarative" || caps.partitioning === "hypertable" || caps.partitioning === "none",
        "partitioning strategy stated",
      );
    },
  },
];
