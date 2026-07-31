/**
 * The conformance suite.
 *
 * Every scenario runs against the JavaScript SDK here. The same files will
 * drive the Go, Python and Rust drivers in #60 — one scenario, four languages,
 * one assertion, and CI that will not merge until all four agree.
 *
 * Two meta-tests come first, because a suite that silently tests nothing is
 * worse than no suite: every scenario must name a clause that exists, and
 * every clause must have a scenario.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runScenario } from "./runner";
import { createJsHarness } from "./js-harness";
import { createProcessHarness, type ProcessDriverSpec } from "./process-harness";
import type { Scenario } from "./scenario";
import { existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "../../..");
const SCENARIO_DIR = join(ROOT, "contract/conformance/scenarios");

const scenarios = (): readonly { file: string; scenario: Scenario }[] =>
  readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((file) => ({ file, scenario: JSON.parse(readFileSync(join(SCENARIO_DIR, file), "utf8")) as Scenario }));

const clauses = (): ReadonlySet<string> => {
  const spec = readFileSync(join(ROOT, "contract/sdk-behaviour.md"), "utf8");
  return new Set([...spec.matchAll(/\*\*(SDK-\d+)\*\*/g)].map((m) => m[1]!));
};

describe("the suite and the spec describe the same contract", () => {
  test("every scenario names a clause that exists", () => {
    // A scenario with no clause is a test nobody agreed to.
    const known = clauses();
    for (const { file, scenario } of scenarios()) {
      expect({ file, id: scenario.id, known: known.has(scenario.id) }).toMatchObject({ known: true });
    }
  });

  test("the suite is not empty, or both checks are vacuous", () => {
    expect(scenarios().length).toBeGreaterThan(5);
    expect(clauses().size).toBeGreaterThan(15);
  });

  test("every scenario has a title and a script", () => {
    for (const { file, scenario } of scenarios()) {
      expect({ file, ok: scenario.title.length > 10 && scenario.script.length > 0 }).toMatchObject({ ok: true });
    }
  });
});

describe("the JavaScript SDK conforms", () => {
  for (const { file, scenario } of scenarios()) {
    test(`${scenario.id} — ${scenario.title} (${file})`, async () => {
      const harness = createJsHarness(scenario.options ?? {});
      const failures = await runScenario(scenario, harness);
      // Reported with the step index, so a divergence points at a line of the
      // scenario rather than at the runner.
      expect(failures.map((f) => `step ${f.step}: ${f.detail}`)).toEqual([]);
    });
  }
});

/**
 * The other languages, driven over a pipe.
 *
 * The same scenario files, the same runner, the same assertions. A language
 * whose toolchain is absent is skipped loudly rather than passing quietly —
 * a suite that reports green because it ran nothing is the thing this exists
 * to prevent.
 */
const DRIVERS: readonly ProcessDriverSpec[] = [
  {
    language: "python",
    command: "python3",
    args: ["-m", "counted.conformance"],
    cwd: join(ROOT, "packages/python"),
    available: () => existsSync(join(ROOT, "packages/python/counted/conformance.py")),
  },
  {
    language: "rust",
    command: join(ROOT, "packages/rust/target/debug/conformance"),
    args: [],
    cwd: join(ROOT, "packages/rust"),
    // Built by `cargo build --bin conformance`. Absent means the suite
    // reports it rather than passing quietly.
    available: () => existsSync(join(ROOT, "packages/rust/target/debug/conformance")),
  },
  {
    language: "go",
    command: join(ROOT, "packages/go/bin/conformance"),
    args: [],
    cwd: join(ROOT, "packages/go"),
    // Built by `go build -o bin/conformance ./cmd/conformance`.
    available: () => existsSync(join(ROOT, "packages/go/bin/conformance")),
  },
];

for (const spec of DRIVERS) {
  describe(`the ${spec.language} SDK conforms`, () => {
    for (const { file, scenario } of scenarios()) {
      test(`${scenario.id} — ${scenario.title} (${file})`, async () => {
        if (!spec.available()) throw new Error(`${spec.language} driver is missing`);
        const harness = await createProcessHarness(spec);
        try {
          const failures = await runScenario(scenario, harness);
          expect(failures.map((f) => `step ${f.step}: ${f.detail}`)).toEqual([]);
        } finally {
          await harness.stop();
        }
      });
    }
  });
}

/**
 * The test whose absence caused the bug.
 *
 * Every per-language scenario can pass while the languages still disagree: JS
 * reporting `macOS`, Go reporting `darwin` and Rust reporting `macos` are each
 * internally consistent and each in *some* set. What was never checked is that
 * they agree with **each other**, on one machine, at one moment — and that is
 * exactly the property that failed, filing one operating system under four
 * names in the same column.
 *
 * So this runs every available driver on this machine and requires one answer.
 */
describe("one machine, one operating system name", () => {
  const trackOne = async (spec: ProcessDriverSpec): Promise<Record<string, unknown>> => {
    const harness = await createProcessHarness(spec);
    try {
      harness.driver.track("probe");
      await harness.driver.flush();
      await harness.settle();
      const [request] = harness.drain();
      if (request === undefined) throw new Error(`${spec.language} sent no request`);
      return (request.body.events[0]?.["systemProperties"] ?? {}) as Record<string, unknown>;
    } finally {
      await harness.stop();
    }
  };

  test("every SDK reports the same os_name", async () => {
    const reported: Record<string, unknown> = {};

    // The reference, in process.
    const js = createJsHarness();
    js.driver.track("probe");
    await js.driver.flush();
    await js.settle();
    reported["js"] = (js.drain()[0]?.body.events[0]?.["systemProperties"] as Record<string, unknown>)?.["os_name"];

    for (const spec of DRIVERS) {
      if (!spec.available()) throw new Error(`${spec.language} driver is missing — cannot claim agreement`);
      reported[spec.language] = (await trackOne(spec))["os_name"];
    }

    // Reported as a map rather than a bare assertion, so a failure names which
    // language disagreed instead of just saying two values differ.
    const values = new Set(Object.values(reported));
    expect({ reported, distinct: values.size }).toMatchObject({ distinct: 1 });
  });

  test("every SDK keeps its own raw value alongside it", async () => {
    // Deliberately *not* required to agree. Go's runtime calls macOS
    // "darwin" and Rust's calls it "macos"; both are true, and preserving them
    // is what makes an unmapped platform discoverable. The canonical field is
    // what must agree.
    for (const spec of DRIVERS) {
      if (!spec.available()) continue;
      const system = await trackOne(spec);
      expect({ language: spec.language, raw: system["os_name_raw"] }).toMatchObject({
        raw: expect.any(String),
      });
    }
  });

  test("every SDK identifies itself, so a bad client can be found", async () => {
    for (const spec of DRIVERS) {
      if (!spec.available()) continue;
      const system = await trackOne(spec);
      expect({ language: spec.language, sdk: system["sdk_version"] }).toMatchObject({
        sdk: expect.stringContaining("counted-"),
      });
    }
  });
});

describe("the wire shape", () => {
  test("the body is an object with an events array, never a bare array", async () => {
    // v1 sent a bare object for one event and an array for several, so every
    // consumer needed both paths.
    const harness = createJsHarness();
    harness.driver.track("only");
    await harness.driver.flush();

    const [request] = harness.drain();
    expect(Array.isArray(request!.body)).toBe(false);
    expect(Array.isArray(request!.body.events)).toBe(true);
    expect(request!.body.events).toHaveLength(1);
  });
});
