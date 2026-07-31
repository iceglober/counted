import { expect, test } from "bun:test";
import { Duration, Instant } from "@counted/domain";
import { PORTS_LAYER } from "./index";

test("ports resolves the domain across the workspace", () => {
  const t = Instant.fromEpochMillis(1_700_000_000_000);
  expect(Instant.toEpochMillis(Instant.plus(t, Duration.minutes(30)))).toBe(1_700_001_800_000);
  expect(PORTS_LAYER).toBe("counted-ports");
});
