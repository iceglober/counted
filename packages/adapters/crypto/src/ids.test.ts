import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "@counted/kernel";
import { fixedClock, scriptedClock } from "@counted/kernel/ports";
import { prefixed, sequentialIdGenerator, uuidV7Generator } from "./ids";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("uuidV7Generator", () => {
  test("mints RFC 9562 version-7 variant-RFC identifiers", () => {
    const id = uuidV7Generator().next();
    expect(id).toMatch(UUID);
    // Version nibble is the 13th hex digit; variant is the 17th and must be
    // 8, 9, a or b. Get either wrong and Postgres' uuid type still accepts it
    // while every parser that checks disagrees about what it is.
    expect(id[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(id[19] as string);
  });

  test("ids minted in the same millisecond still sort in mint order", () => {
    // The reason for choosing v7 over v4 is sortability, and the moment it is
    // load-bearing is a burst — when the timestamp cannot separate them.
    const generator = uuidV7Generator(fixedClock(Instant.fromEpochMillis(1_700_000_000_000)));
    const ids = Array.from({ length: 500 }, () => generator.next());
    expect([...ids].sort()).toEqual(ids);
  });

  test("ids sort by the instant they were minted", () => {
    const clock = scriptedClock(Instant.fromEpochMillis(1_700_000_000_000));
    const generator = uuidV7Generator(clock);
    const first = generator.next();
    clock.advance(Duration.hours(1));
    const second = generator.next();
    expect(first < second).toBe(true);
  });

  test("a clock that steps backwards does not produce an id that sorts earlier", () => {
    // NTP steps and VM migrations both do this. Wrapping back would emit an id
    // that sorts before one issued a moment ago, which quietly breaks every
    // `ORDER BY id` in the product.
    let millis = 1_700_000_000_000;
    const jumpy = { now: () => Instant.fromEpochMillis(millis) };
    const generator = uuidV7Generator(jumpy);
    const before = generator.next();
    millis -= 60_000;
    const after = generator.next();
    expect(after > before).toBe(true);
  });

  test("survives more ids in one millisecond than the counter can hold", () => {
    // rand_a is 12 bits. Past ~2048 in a millisecond the counter overflows and
    // the generator borrows from the next millisecond rather than wrapping.
    const generator = uuidV7Generator(fixedClock(Instant.fromEpochMillis(1_700_000_000_000)));
    const ids = Array.from({ length: 6_000 }, () => generator.next());
    expect(new Set(ids).size).toBe(6_000);
    expect([...ids].sort()).toEqual(ids);
  });

  test("ids are unique across a large batch on a real clock", () => {
    const generator = uuidV7Generator();
    const ids = new Set(Array.from({ length: 20_000 }, () => generator.next()));
    expect(ids.size).toBe(20_000);
  });

  test("two generators sharing a clock do not collide", () => {
    // Each holds its own counter, so ordering across them is not guaranteed —
    // but the 62 random bits mean they must not produce the same id.
    const clock = fixedClock(Instant.fromEpochMillis(1_700_000_000_000));
    const a = uuidV7Generator(clock);
    const b = uuidV7Generator(clock);
    const ids = new Set([
      ...Array.from({ length: 1_000 }, () => a.next()),
      ...Array.from({ length: 1_000 }, () => b.next()),
    ]);
    expect(ids.size).toBe(2_000);
  });
});

describe("sequentialIdGenerator", () => {
  test("is predictable, which is the only reason to use it", () => {
    const generator = sequentialIdGenerator("ws-");
    expect([generator.next(), generator.next(), generator.next()]).toEqual([
      "ws-1",
      "ws-2",
      "ws-3",
    ]);
  });
});

describe("prefixed", () => {
  test("prefixes without changing the underlying sequence", () => {
    const generator = prefixed(sequentialIdGenerator(), "evt_");
    expect(generator.next()).toBe("evt_id-1");
  });
});
