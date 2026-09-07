/**
 * Zero hand-written response shapes, asserted rather than remembered.
 *
 * v2 declared about twenty types describing what the API returns, guarded by a
 * regex test, and the file that held them documented the bug that caused: a
 * hand-written shape and the contract disagreed, the compiler could not see it,
 * and the page rendered `undefined` where a number should have been.
 *
 * The fix is that the types come from `RouterContractClient`. This is the
 * guard that keeps it true. It reads every schema the contract exports, and
 * fails if the console declares a type with one of those names unless the
 * declaration is *derived* — `z.infer<typeof …Schema>`, `ContractInputs`,
 * `ContractOutputs`, or a projection of one of those. An `interface` with such
 * a name can never be derived, so it is refused outright.
 *
 * What this deliberately does not do is ban every local type. `Failure`,
 * `Attempt` and `Authority` describe this app's own control flow and nothing on
 * the wire; a rule that banned them would be a rule people turn off.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as contractModule from "@counted/contract";

const SOURCE_ROOT = join(import.meta.dir, "..");

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });

/**
 * Every wire shape the contract names, derived from its exports rather than
 * listed. A schema added to the contract tomorrow is covered by this test
 * today, which is the property a hand-maintained list cannot have.
 */
const WIRE_SHAPES: readonly string[] = Object.keys(contractModule)
  .filter((name) => name.endsWith("Schema"))
  .map((name) => name.slice(0, -"Schema".length))
  .filter((name) => name.length > 0);

/**
 * A right-hand side that reads its shape out of the contract, directly or
 * through another local alias that does. Indexing into a local type is allowed
 * because whatever it indexes into is itself checked by this test — a chain
 * rooted in a hand-written shape still fails, at its root.
 */
const DERIVED =
  /(z\.infer\s*<|ContractInputs|ContractOutputs|ConsoleClient|Extract<|NonNullable<|=\s*[A-Z][A-Za-z0-9_]*\s*\[)/;

type Declaration = { readonly file: string; readonly name: string; readonly kind: string; readonly rhs: string };

const declarations = (path: string): readonly Declaration[] => {
  const source = readFileSync(path, "utf8");
  const found: Declaration[] = [];
  // Anchored to the start of a line so an `import { type X }` is not mistaken
  // for a declaration of X — the import is the opposite of the thing this test
  // looks for.
  for (const match of source.matchAll(/^\s*(?:export\s+)?(type|interface)\s+([A-Z][A-Za-z0-9_]*)\b([^;{]*)/gm)) {
    found.push({ file: path, kind: match[1] ?? "", name: match[2] ?? "", rhs: match[3] ?? "" });
  }
  return found;
};

const all = sourceFiles(SOURCE_ROOT).flatMap(declarations);

describe("no hand-written response shapes", () => {
  test("the contract exports enough schemas for this test to mean something", () => {
    // A guard that scans an empty list passes for the wrong reason.
    expect(WIRE_SHAPES.length).toBeGreaterThan(30);
    expect(WIRE_SHAPES).toContain("Dashboard");
    expect(WIRE_SHAPES).toContain("Credential");
    expect(WIRE_SHAPES).toContain("Usage");
  });

  test("a type named after a wire shape is derived from the contract", () => {
    const offenders = all
      .filter((one) => WIRE_SHAPES.includes(one.name))
      .filter((one) => one.kind === "interface" || !DERIVED.test(one.rhs))
      .map((one) => `${one.file}: ${one.kind} ${one.name} =${one.rhs.trim()}`);
    expect(offenders).toEqual([]);
  });

  test("no interface in the console describes anything the API returns", () => {
    // An interface cannot be a projection of a contract type, so any interface
    // with a wire shape's name is by construction a second definition of it.
    const interfaces = all.filter((one) => one.kind === "interface").map((one) => one.name);
    expect(interfaces.filter((name) => WIRE_SHAPES.includes(name))).toEqual([]);
  });
});
