/**
 * The contract suites, run against an in-memory reference store.
 *
 * A contract nobody has executed is a wish, not a contract. This file proves
 * the suites are runnable and satisfiable *before* Phase 2 starts building the
 * Postgres adapter against them — so a failure there means the adapter is
 * wrong, not that the contract was never viable.
 *
 * The reference implementation also doubles as executable documentation of
 * what each request kind means, in about a hundred lines of obvious code.
 */

import { describe, test } from "bun:test";
import {
  Analysis,
  Instant,
  Measure,
  Predicate,
  TimeAxis,
  type FieldRef,
  type ProjectId,
} from "@counted/domain";
import { allStoreContracts } from "./index";
import type { StoreFixture } from "./fixtures";
import type {
  AnalyticalStore,
  BatchOutcome,
  Outcome,
  StoreRequest,
  StoreResult,
} from "../driven/analytical-store";
import type { AppendReceipt, EventWriter, WritableEvent } from "../driven/event-writer";

// ── An in-memory reference store ─────────────────────────────────────────────

const makeReference = (project: ProjectId): StoreFixture => {
  let rows: WritableEvent[] = [];
  const seen = new Set<string>();

  const writer: EventWriter = {
    append: async (events): Promise<AppendReceipt> => {
      let accepted = 0;
      let deduplicated = 0;
      for (const e of events) {
        const key = `${e.project}:${e.idempotencyKey}`;
        if (seen.has(key)) {
          deduplicated++;
          continue;
        }
        seen.add(key);
        rows.push(e);
        accepted++;
      }
      return { accepted, deduplicated, committedAt: Instant.fromEpochMillis(Date.now()) };
    },
  };

  const fieldValue = (e: WritableEvent, f: FieldRef): unknown =>
    f.source === "system"
      ? f.key === "event_name"
        ? e.name
        : e.system[f.key] ?? null
      : e.properties[f.key] ?? null;

  const matches = (e: WritableEvent, p: Predicate): boolean => {
    switch (p.op) {
      case "and":
        return p.operands.every((o) => matches(e, o));
      case "or":
        return p.operands.some((o) => matches(e, o));
      case "not":
        return !matches(e, p.operand);
      case "eq":
        return fieldValue(e, p.field) === p.value;
      case "neq":
        return fieldValue(e, p.field) !== p.value;
      case "in":
        return p.values.includes(fieldValue(e, p.field) as never);
      case "notIn":
        return !p.values.includes(fieldValue(e, p.field) as never);
      case "contains":
        return String(fieldValue(e, p.field) ?? "").includes(p.value);
      case "startsWith":
        return String(fieldValue(e, p.field) ?? "").startsWith(p.value);
      case "endsWith":
        return String(fieldValue(e, p.field) ?? "").endsWith(p.value);
      case "exists":
        return fieldValue(e, p.field) !== null;
      case "notExists":
        return fieldValue(e, p.field) === null;
      // Numeric comparisons guard the cast — a non-numeric value simply does
      // not match, rather than failing the whole query the way v1's unguarded
      // ::numeric did.
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const raw = fieldValue(e, p.field);
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) return false;
        return p.op === "gt" ? n > p.value : p.op === "gte" ? n >= p.value : p.op === "lt" ? n < p.value : n <= p.value;
      }
      default:
        return false;
    }
  };

  const select = (r: Extract<StoreRequest, { analysis: Analysis }>): WritableEvent[] =>
    rows.filter((e) => {
      if (e.project !== r.project) return false;
      if (e.occurredAt < r.bounds.from || e.occurredAt >= r.bounds.to) return false;
      const names = r.analysis.events ?? [];
      if (names.length > 0 && !names.includes(e.name)) return false;
      if (r.analysis.where !== undefined && !matches(e, r.analysis.where)) return false;
      return true;
    });

  const measure = (events: readonly WritableEvent[], a: Analysis): number => {
    const m = a.measure;
    if (m.kind === "count") return events.length;
    if (m.kind === "distinct") {
      const key = (e: WritableEvent) => (m.basis === "person" ? e.person : e.visit);
      return new Set(events.map(key).filter((v) => v !== null)).size;
    }
    // Skip values that are not numbers rather than failing the query.
    const numbers = events
      .map((e) => e.properties[m.property])
      .map((v) => (typeof v === "number" ? v : Number(v)))
      .filter((n) => Number.isFinite(n));
    if (numbers.length === 0) return 0;
    switch (m.fn) {
      case "sum":
        return numbers.reduce((x, y) => x + y, 0);
      case "avg":
        return numbers.reduce((x, y) => x + y, 0) / numbers.length;
      case "min":
        return Math.min(...numbers);
      case "max":
        return Math.max(...numbers);
    }
  };

  const store: AnalyticalStore = {
    executeBatch: async (requests): Promise<BatchOutcome> => {
      const results = new Map<StoreRequest["id"], Outcome<StoreResult>>();
      const byKey = new Map<string, StoreResult>();
      let statements = 0;
      let coalesced = 0;
      const computedAt = Instant.fromEpochMillis(Date.now());

      for (const r of requests) {
        // Coalesce identical questions — the reason Analysis.toKey exists.
        const key =
          r.kind === "sequence" || r.kind === "cohorts"
            ? `${r.kind}:${r.project}`
            : `${r.kind}:${r.project}:${Analysis.toKey(r.analysis)}:${r.bounds.from}-${r.bounds.to}`;

        const cached = byKey.get(key);
        if (cached !== undefined) {
          coalesced++;
          results.set(r.id, { ok: true, value: cached, from: "store", computedAt });
          continue;
        }
        statements++;

        let value: StoreResult;
        switch (r.kind) {
          case "scalar":
            value = { kind: "scalar", value: measure(select(r), r.analysis) };
            break;
          case "series": {
            const counts = new Array<number>(TimeAxis.bucketCount(r.axis)).fill(0);
            for (const e of select(r)) {
              const i = TimeAxis.assign(r.axis, e.occurredAt);
              if (i !== null) counts[i] = (counts[i] ?? 0) + 1;
            }
            value = { kind: "series", values: counts };
            break;
          }
          case "breakdown": {
            const dim = (r.analysis.groupBy ?? []).find((d) => d.by === "field");
            const groups = new Map<string, WritableEvent[]>();
            for (const e of select(r)) {
              const label =
                dim === undefined || dim.by !== "field"
                  ? "all"
                  : String(fieldValue(e, dim.field) ?? "unknown");
              groups.set(label, [...(groups.get(label) ?? []), e]);
            }
            const rowsOut = [...groups.entries()]
              .map(([label, es]) => ({ label, value: measure(es, r.analysis) }))
              .sort((a, b) => b.value - a.value);
            value = { kind: "breakdown", rows: rowsOut };
            break;
          }
          case "sequence":
            value = { kind: "sequence", counts: r.funnel.steps.map(() => 0) };
            break;
          case "cohorts":
            value = { kind: "cohorts", sizes: [], observations: [] };
            break;
        }

        byKey.set(key, value);
        results.set(r.id, { ok: true, value, from: "store", computedAt });
      }

      return { results, stats: { statements, totalMs: 0, coalesced } };
    },
    capabilities: () => ({ engine: "in-memory-reference", approximateDistinct: false, partitioning: "none" }),
  };

  return {
    store,
    writer,
    project,
    reset: async () => {
      rows = [];
      seen.clear();
    },
  };
};

// ── Run every contract against it ────────────────────────────────────────────

describe("contract suites run against the in-memory reference", () => {
  const fixture = makeReference("prj_reference" as ProjectId);

  for (const contractCase of allStoreContracts) {
    test(contractCase.name, async () => {
      await contractCase.run(fixture);
    });
  }
});
