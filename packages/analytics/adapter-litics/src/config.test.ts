import { describe, expect, test } from "bun:test";
import { intervalSeconds } from "@litics/core";
import { DIMENSIONS, MAX_WINDOW } from "@counted/analytics-domain";
import { Duration } from "@counted/kernel";

import {
  INDEXED_DIMENSIONS,
  FUNNEL_MAX_DAYS,
  PLANNED_DIMENSIONS,
  resolvedStream,
  SEGMENT_RETENTION_DAYS,
  SEGMENT_ROWS,
} from "./config";

describe("the config and the domain agree", () => {
  test("every dimension the SDKs collect has a column of its own, and nothing else does", () => {
    // The litics config is a schema artifact that must
    // agree with the domain's event vocabulary — one source of truth, drift
    // fails CI. Add a dimension to `DIMENSIONS` without adding a column and
    // this is what tells you.
    const collected = DIMENSIONS.filter((d) => d.availability === "collected").map((d) => d.name);
    expect([...INDEXED_DIMENSIONS].sort()).toEqual([...collected].sort());
  });

  test("a `planned` dimension has no column, so a filter on it can be refused rather than answered", () => {
    // Vacuous today: `country` was the only `planned` entry and it is collected
    // now. Kept as a standing check, because the next dimension we name before
    // we collect it must not quietly acquire a column — a column with no writer
    // reads as "nobody is in that bucket" rather than as "we do not have that".
    const planned = DIMENSIONS.filter((d) => d.availability === "planned").map((d) => d.name);
    for (const name of planned) expect(INDEXED_DIMENSIONS).not.toContain(name);
    expect(PLANNED_DIMENSIONS).toEqual(planned);
  });

  test("country is a column, an int2, and the only dimension we derive", () => {
    // The dimension the SDKs do not send. It is here because ingestion works it
    // out from the request address and throws the address away — so this column
    // is the only record that a request came from anywhere, and it is two
    // letters wide.
    expect(INDEXED_DIMENSIONS).toContain("country");
    const column = resolvedStream.dimensions.find((d) => d.name === "country");
    expect(column?.type).toBe("int2");
  });

  test("event_type leads the sliceable list, because it is what every question filters on first", () => {
    expect(INDEXED_DIMENSIONS[0]).toBe("event_type");
    expect(resolvedStream.sortBy).toBe("event_type");
  });
});

describe("retention is checkable", () => {
  test("retention is written in units litics can parse, and matches the number the refusal quotes", () => {
    // The window-versus-retention refusal in plan.ts compares against this.
    // `intervalSeconds` returns null for months, so '25 months' would turn the
    // whole check into a silent no-op and truncated charts would come back.
    expect(intervalSeconds(resolvedStream.retention)).toBe(SEGMENT_RETENTION_DAYS * 86_400);
  });

  test("retention outlives the longest window anyone may ask for", () => {
    // Otherwise the most ordinary question in the product — two years, daily —
    // is refused by its own retention check.
    const maxDays = Duration.toMillis(MAX_WINDOW) / 86_400_000;
    expect(SEGMENT_RETENTION_DAYS).toBeGreaterThanOrEqual(maxDays);
  });

  test("a funnel's window cap is inside retention and at least a quarter", () => {
    expect(FUNNEL_MAX_DAYS).toBeGreaterThanOrEqual(90);
    expect(FUNNEL_MAX_DAYS).toBeLessThanOrEqual(SEGMENT_RETENTION_DAYS);
  });
});

describe("the stream", () => {
  test("actor and tenant are text, because Counted's ids are branded strings and not uuids", () => {
    expect(resolvedStream.actorType).toBe("text");
  });

  test("no numeric measure is declared, and the catalog says the same thing", () => {
    // Declaring one nothing writes would build a summary that sums zeroes — a
    // flat line at nought, which reads as "no revenue" rather than "not
    // collected". See config.ts.
    expect(resolvedStream.measures).toHaveLength(0);
  });

  test("event types are an open set, so an event name nobody predicted is not an error", () => {
    expect(resolvedStream.eventTypes).toBeNull();
  });

  test("segments hold ten thousand events, and dedup is admission's job", () => {
    expect(resolvedStream.segmentRows).toBe(SEGMENT_ROWS);
    expect(resolvedStream.idempotentIngest).toBe(false);
  });
});
