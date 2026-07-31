import { describe, expect, test } from "bun:test";
import { Analysis, Duration, Instant, Measure, ProjectId, TimeAxis, Window } from "@counted/domain";
import {
  RequestId,
  type AnalyticalStore,
  type BatchOutcome,
  type Outcome,
  type StoreRequest,
  type StoreResult,
} from "./index";

const t0 = Instant.fromEpochMillis(1_700_000_000_000);
const prj = ProjectId("prj_1");

/**
 * A stand-in store. That this is possible at all is the point of the port:
 * every use case can be exercised with no database, no container, no network.
 */
const stubStore = (answers: ReadonlyMap<RequestId, Outcome<StoreResult>>): AnalyticalStore => ({
  executeBatch: async (requests): Promise<BatchOutcome> => ({
    results: new Map(
      requests.map((r) => [
        r.id,
        answers.get(r.id) ?? {
          ok: false as const,
          error: { code: "invalid_request" as const, detail: "no stub answer", retriable: false as const },
        },
      ]),
    ),
    stats: { statements: requests.length, totalMs: 0, coalesced: 0 },
  }),
  capabilities: () => ({ engine: "stub", approximateDistinct: false, partitioning: "none" }),
});

describe("the store answers every request it was given", () => {
  test("one outcome per request id", async () => {
    const a = RequestId("a");
    const b = RequestId("b");
    const store = stubStore(
      new Map<RequestId, Outcome<StoreResult>>([
        [a, { ok: true, value: { kind: "scalar", value: 42 }, from: "store", computedAt: t0 }],
        [b, { ok: false, error: { code: "timeout", budgetMs: 500, retriable: true } }],
      ]),
    );

    const requests: StoreRequest[] = [
      { id: a, kind: "scalar", project: prj, analysis: Analysis.countOverWindow(Window.lastDays(7)) },
      { id: b, kind: "scalar", project: prj, analysis: Analysis.countOverWindow(Window.lastDays(30)) },
    ];

    const outcome = await store.executeBatch(requests, { deadlineMs: 1_000, traceId: "t" });
    expect(outcome.results.size).toBe(2);
    expect(outcome.results.get(a)?.ok).toBe(true);
    expect(outcome.results.get(b)?.ok).toBe(false);
  });

  test("a failure carries a reason and whether retrying could help", async () => {
    const id = RequestId("x");
    const store = stubStore(
      new Map<RequestId, Outcome<StoreResult>>([
        [id, { ok: false, error: { code: "store_unavailable", detail: "pool exhausted", retriable: true } }],
      ]),
    );
    const result = (
      await store.executeBatch(
        [{ id, kind: "scalar", project: prj, analysis: Analysis.countOverWindow(Window.lastDays(1)) }],
        { deadlineMs: 100, traceId: "t" },
      )
    ).results.get(id)!;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.retriable).toBe(true);
      expect(result.error.code).toBe("store_unavailable");
    }
  });
});

describe("Outcome has no zero value", () => {
  test("a value is only reachable after checking ok", () => {
    const failed: Outcome<StoreResult> = {
      ok: false,
      error: { code: "timeout", budgetMs: 250, retriable: true },
    };

    // `failed.value` does not compile — the property does not exist on the
    // error variant. There is no "empty result" a failure can decay into, so
    // v1's emptyData() cannot be written at this layer. There, every rejection
    // became a blank chart indistinguishable from an empty project.
    expect(failed.ok).toBe(false);

    let reached = false;
    if (failed.ok) reached = true;
    expect(reached).toBe(false);
  });

  test("the success variant carries provenance and a timestamp", () => {
    const answered: Outcome<StoreResult> = {
      ok: true,
      value: { kind: "scalar", value: 7 },
      from: "cache",
      computedAt: t0,
    };
    if (answered.ok) {
      expect(answered.from).toBe("cache");
      expect(answered.computedAt).toBe(t0);
    }
  });
});

describe("the store is handed bucket edges, it does not bucket", () => {
  test("a series request carries the domain's axis", () => {
    const axis = TimeAxis.build(Window.lastDays(3), "day", t0);
    const request: StoreRequest = {
      id: RequestId("s"),
      kind: "series",
      project: prj,
      analysis: Analysis.timeSeries(Measure.count(), Window.lastDays(3), "day"),
      axis,
    };

    expect(request.kind).toBe("series");
    if (request.kind === "series") {
      // Edges, not a bucket expression. There is no second implementation for
      // SQL to disagree with.
      expect(request.axis.edges.length).toBe(TimeAxis.bucketCount(axis) + 1);
      expect(TimeAxis.edgeMillis(request.axis).every(Number.isInteger)).toBe(true);
    }
  });

  test("a series result is dense and aligned to that axis", () => {
    const axis = TimeAxis.build(Window.lastDays(3), "day", t0);
    const result: StoreResult = {
      kind: "series",
      values: new Array<number>(TimeAxis.bucketCount(axis)).fill(0),
    };
    if (result.kind === "series") expect(result.values.length).toBe(TimeAxis.bucketCount(axis));
  });
});

describe("the store returns raw counts; the domain does the arithmetic", () => {
  test("a funnel comes back as counts per step, not as rates", () => {
    const result: StoreResult = { kind: "sequence", counts: [1000, 400, 100] };
    if (result.kind === "sequence") {
      // Funnel.summarize turns these into rates and rejects a rising series.
      // Keeping that in the domain is what makes it testable without a store.
      expect(result.counts).toEqual([1000, 400, 100]);
    }
  });

  test("retention comes back as sizes and observations, not as a grid", () => {
    const result: StoreResult = {
      kind: "cohorts",
      sizes: [{ cohortStart: t0, size: 100 }],
      observations: [{ cohortStart: t0, periodStart: t0, returned: 100 }],
    };
    if (result.kind === "cohorts") {
      expect(result.sizes).toHaveLength(1);
      // Retention.buildGrid does the calendar indexing and the unknowable-vs-
      // zero distinction, neither of which belongs in SQL.
      expect(result.observations).toHaveLength(1);
    }
  });
});

describe("capabilities are probed, not assumed", () => {
  test("a store states what it can do", () => {
    const caps = stubStore(new Map()).capabilities();
    expect(caps.engine).toBe("stub");
    expect(caps.partitioning).toBe("none");
    // v1 assumed TimescaleDB. On plain Postgres its migration failed silently
    // on every boot and every timeseries query threw at runtime, which users
    // saw as empty charts rather than an error.
    expect(typeof caps.approximateDistinct).toBe("boolean");
  });
});

describe("deadlines are part of the contract", () => {
  test("every batch carries a budget the adapter must honour", async () => {
    let seen = 0;
    const store: AnalyticalStore = {
      executeBatch: async (requests, options) => {
        seen = options.deadlineMs;
        return {
          results: new Map(
            requests.map((r) => [
              r.id,
              { ok: false as const, error: { code: "timeout" as const, budgetMs: options.deadlineMs, retriable: true as const } },
            ]),
          ),
          stats: { statements: 0, totalMs: 0, coalesced: 0 },
        };
      },
      capabilities: () => ({ engine: "stub", approximateDistinct: false, partitioning: "none" }),
    };

    await store.executeBatch([], { deadlineMs: Duration.toMillis(Duration.seconds(2)), traceId: "t" });
    expect(seen).toBe(2_000);
  });
});
