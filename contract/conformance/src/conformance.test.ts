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
import type { Scenario } from "./scenario";

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
