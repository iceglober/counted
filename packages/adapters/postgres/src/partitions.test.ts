import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "@counted/domain";
import {
  createPartitionSql,
  dropPartitionSql,
  expiredPartitions,
  parsePartitionName,
  partitionFor,
  partitionsCovering,
} from "./partitions";

const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));
const show = (i: Instant) => Instant.toISO(i);

describe("partitionFor", () => {
  test("names a partition after its month", () => {
    expect(partitionFor(iso("2026-03-17T14:37:00Z")).name).toBe("events_2026_03");
    expect(partitionFor(iso("2026-12-31T23:59:59Z")).name).toBe("events_2026_12");
    expect(partitionFor(iso("2027-01-01T00:00:00Z")).name).toBe("events_2027_01");
  });

  test("bounds are the calendar month, half-open", () => {
    const p = partitionFor(iso("2026-03-17T14:37:00Z"));
    expect(show(p.from)).toBe("2026-03-01T00:00:00.000Z");
    expect(show(p.to)).toBe("2026-04-01T00:00:00.000Z");
  });

  test("February is 28 or 29 days, because the domain walks the calendar", () => {
    const feb26 = partitionFor(iso("2026-02-15T00:00:00Z"));
    expect(Duration.toMillis(Instant.between(feb26.from, feb26.to))).toBe(28 * 86_400_000);

    const feb28 = partitionFor(iso("2028-02-15T00:00:00Z"));
    expect(Duration.toMillis(Instant.between(feb28.from, feb28.to))).toBe(29 * 86_400_000);
  });

  test("an instant exactly on a boundary belongs to the month it starts", () => {
    expect(partitionFor(iso("2026-04-01T00:00:00Z")).name).toBe("events_2026_04");
    expect(partitionFor(iso("2026-03-31T23:59:59.999Z")).name).toBe("events_2026_03");
  });
});

describe("partitionsCovering", () => {
  test("covers the range and runs ahead of it", () => {
    const specs = partitionsCovering(iso("2026-01-15T00:00:00Z"), iso("2026-03-10T00:00:00Z"), 2);
    expect(specs.map((s) => s.name)).toEqual([
      "events_2026_01",
      "events_2026_02",
      "events_2026_03",
      "events_2026_04",
      "events_2026_05",
    ]);
  });

  test("running ahead is the point — ingestion must never race partition creation", () => {
    // Without lookahead, rows land in the default partition and pruning is
    // silently lost.
    const none = partitionsCovering(iso("2026-01-15T00:00:00Z"), iso("2026-01-20T00:00:00Z"), 0);
    expect(none.map((s) => s.name)).toEqual(["events_2026_01"]);

    const ahead = partitionsCovering(iso("2026-01-15T00:00:00Z"), iso("2026-01-20T00:00:00Z"), 3);
    expect(ahead.map((s) => s.name)).toEqual([
      "events_2026_01",
      "events_2026_02",
      "events_2026_03",
      "events_2026_04",
    ]);
  });

  test("crosses a year boundary", () => {
    const specs = partitionsCovering(iso("2026-11-05T00:00:00Z"), iso("2027-01-05T00:00:00Z"), 1);
    expect(specs.map((s) => s.name)).toEqual([
      "events_2026_11",
      "events_2026_12",
      "events_2027_01",
      "events_2027_02",
    ]);
  });

  test("a single-month range still produces that month", () => {
    const specs = partitionsCovering(iso("2026-06-01T00:00:00Z"), iso("2026-06-30T00:00:00Z"), 0);
    expect(specs.map((s) => s.name)).toEqual(["events_2026_06"]);
  });

  test("partitions are contiguous — no gap, no overlap", () => {
    const specs = partitionsCovering(iso("2026-01-01T00:00:00Z"), iso("2026-12-01T00:00:00Z"), 0);
    for (let i = 1; i < specs.length; i++) {
      expect(specs[i]!.from).toBe(specs[i - 1]!.to);
    }
  });

  test("a pathological range is bounded rather than looping forever", () => {
    const specs = partitionsCovering(iso("1990-01-01T00:00:00Z"), iso("2090-01-01T00:00:00Z"), 0);
    expect(specs.length).toBeLessThanOrEqual(601);
  });
});

describe("DDL", () => {
  test("create names the parent, the child and both bounds", () => {
    const sql = createPartitionSql(partitionFor(iso("2026-03-17T00:00:00Z")));
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS events_2026_03");
    expect(sql).toContain("PARTITION OF events");
    expect(sql).toContain("FROM ('2026-03-01T00:00:00.000Z')");
    expect(sql).toContain("TO ('2026-04-01T00:00:00.000Z')");
  });

  test("drop is the retention mechanism — O(1), no vacuum, no lock on live data", () => {
    expect(dropPartitionSql(partitionFor(iso("2026-03-17T00:00:00Z")))).toBe(
      "DROP TABLE IF EXISTS events_2026_03;",
    );
  });

  test("create is idempotent, so the ensure job can run every hour", () => {
    expect(createPartitionSql(partitionFor(iso("2026-03-17T00:00:00Z")))).toContain("IF NOT EXISTS");
  });
});

describe("expiredPartitions", () => {
  const specs = partitionsCovering(iso("2026-01-01T00:00:00Z"), iso("2026-06-01T00:00:00Z"), 0);

  test("drops only partitions entirely past the cut-off", () => {
    const expired = expiredPartitions(specs, iso("2026-04-01T00:00:00Z"));
    expect(expired.map((s) => s.name)).toEqual(["events_2026_01", "events_2026_02", "events_2026_03"]);
  });

  test("never drops the partition containing the cut-off", () => {
    // That partition still holds data the customer is entitled to. This
    // off-by-one would be unrecoverable.
    const expired = expiredPartitions(specs, iso("2026-04-15T00:00:00Z"));
    expect(expired.map((s) => s.name)).not.toContain("events_2026_04");
  });

  test("a cut-off before everything drops nothing", () => {
    expect(expiredPartitions(specs, iso("2025-01-01T00:00:00Z"))).toHaveLength(0);
  });

  test("retention of 180 days keeps roughly six months", () => {
    const now = iso("2026-06-15T00:00:00Z");
    const cutoff = Instant.minus(now, Duration.days(180));
    const expired = expiredPartitions(specs, cutoff);
    // 180 days before 2026-06-15 is 2025-12-17, so nothing in 2026 is gone yet.
    expect(expired).toHaveLength(0);
  });
});

describe("parsePartitionName", () => {
  test("round-trips a generated name", () => {
    const original = partitionFor(iso("2026-03-17T00:00:00Z"));
    const parsed = parsePartitionName(original.name);
    expect(parsed).not.toBeNull();
    expect(parsed!.from).toBe(original.from);
    expect(parsed!.to).toBe(original.to);
  });

  test("ignores tables that are not ours", () => {
    expect(parsePartitionName("events_default")).toBeNull();
    expect(parsePartitionName("events")).toBeNull();
    expect(parsePartitionName("some_other_table")).toBeNull();
    expect(parsePartitionName("events_2026_13")).toBeNull();
    expect(parsePartitionName("events_2026_3")).toBeNull();
  });
});
