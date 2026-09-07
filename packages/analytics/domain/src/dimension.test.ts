import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CATALOG,
  DIMENSIONS,
  DimensionCatalog,
  dimensionSpec,
  isDimensionName,
} from "./dimension";

describe("the declared dimension set", () => {
  test("is exactly what the SDK sends, plus the one thing the edge derives", () => {
    expect(DIMENSIONS.map((d) => d.name)).toEqual([
      "event_type",
      "os_name",
      "os_version",
      "locale",
      "app_version",
      "device_model",
      "sdk_version",
      "country",
    ]);
  });

  test("country is collected, and is indexed like every other collected dimension", () => {
    // It is the one dimension no SDK sends: derived at ingest from the request
    // address, which is discarded in the same breath. By the time a query is
    // planned that difference is invisible, and this asserts it.
    const country = dimensionSpec("country");
    expect(country.availability).toBe("collected");
    expect(country.pending).toBeUndefined();
    expect(DEFAULT_CATALOG.indexed).toContain("country");
  });

  test("every declared dimension is indexed by default, and none is planned", () => {
    for (const spec of DIMENSIONS) {
      expect(DimensionCatalog.status(DEFAULT_CATALOG, spec.name)).toBe("indexed");
    }
    // `planned` has no members today. The state stays in the model — the next
    // dimension we design before we collect lands in it — but nothing is in it,
    // so nothing is refused with "not collected yet" by default.
    expect(DEFAULT_CATALOG.planned).toEqual([]);
  });

  test("a `pending` sentence exists only where availability is `planned`", () => {
    // The invariant the optional field encodes. A `collected` dimension
    // carrying a reason it is not collected is a comment that has outlived
    // what it described.
    for (const spec of DIMENSIONS) {
      if (spec.availability === "collected") expect(spec.pending).toBeUndefined();
      else expect(spec.pending).toBeString();
    }
  });

  test("a customer property is unknown until the project declares it", () => {
    expect(DimensionCatalog.status(DEFAULT_CATALOG, "plan")).toBe("unknown");
    const withPlan = DimensionCatalog.withIndexed(DEFAULT_CATALOG, ["plan"]);
    expect(DimensionCatalog.status(withPlan, "plan")).toBe("indexed");
  });

  test("declaring a planned dimension moves it out of planned", () => {
    // Built rather than borrowed: no dimension is `planned` by default now, and
    // this is the transition that happens when a project's index gains a column
    // the product had already named.
    const pending = DimensionCatalog.of(["event_type", "locale"], ["country"]);
    expect(DimensionCatalog.status(pending, "country")).toBe("planned");

    const collected = DimensionCatalog.withIndexed(pending, ["country"]);
    expect(DimensionCatalog.status(collected, "country")).toBe("indexed");
    expect(collected.planned).toEqual([]);
  });

  test("isDimensionName is the only name inference in the system", () => {
    expect(isDimensionName("locale")).toBe(true);
    expect(isDimensionName("Locale")).toBe(false);
    expect(isDimensionName("plan")).toBe(false);
  });
});
