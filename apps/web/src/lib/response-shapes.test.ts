/**
 * Hand-written response types must agree with the contract.
 *
 * `api<T>("listDashboards", …)` is an unchecked generic cast: `T` is whatever
 * the caller claims, and the compiler has no way to know the API disagrees. So
 * `type DashboardList = { dashboards: … }` type-checked perfectly against an
 * endpoint that returns `{ items: … }`, and the page died on
 * `undefined is not an object (evaluating 'a.dashboards.length')`.
 *
 * It survived because the page was unreachable: `/dashboards` redirected to the
 * marketing homepage, so the line never ran until that was fixed. Every other
 * list endpoint in the console had it right — `listProjects`,
 * `listCredentials`, `listMonitors` all read `items` — which is exactly the
 * kind of lone disagreement no reviewer notices.
 *
 * This reads the committed `openapi.json`, which CI already drift-gates against
 * the running server, and checks that each top-level property a page reads off
 * a response actually exists in that operation's schema.
 *
 * Deliberately shallow: one level of property access, on the success response.
 * Deeper checking wants generated types, which is the real fix and a larger
 * change. This catches the shape of the bug that actually happened.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const APP = join(import.meta.dir, "..");

type Schema = Record<string, unknown>;
const spec = JSON.parse(readFileSync(join(ROOT, "openapi.json"), "utf8")) as {
  paths: Record<string, Record<string, { operationId?: string; responses: Record<string, Schema> }>>;
  components?: { schemas?: Record<string, Schema> };
};

const deref = (node: unknown): Schema => {
  let current = node as Schema;
  let guard = 0;
  while (current !== null && typeof current === "object" && "$ref" in current && guard < 10) {
    const path = String(current["$ref"]).split("/").slice(1);
    let found: unknown = spec;
    for (const key of path) found = (found as Record<string, unknown>)[key];
    current = found as Schema;
    guard += 1;
  }
  return current ?? {};
};

/** Top-level properties of an operation's success response. */
const responseProperties = (): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const operations of Object.values(spec.paths)) {
    for (const operation of Object.values(operations)) {
      const id = operation.operationId;
      if (id === undefined) continue;
      for (const [code, response] of Object.entries(operation.responses)) {
        if (!code.startsWith("2")) continue;
        const content = (response["content"] as Record<string, Schema> | undefined) ?? {};
        const schema = deref(content["application/json"]?.["schema"]);
        const properties = (schema["properties"] as Record<string, unknown> | undefined) ?? {};
        const names = Object.keys(properties);
        if (names.length > 0) out.set(id, new Set(names));
      }
    }
  }
  return out;
};

/**
 * Property names at brace depth 1 of a type literal.
 *
 * Depth matters: `{ items: readonly { id: string }[] }` declares one property,
 * not three. A flat regex reads `id` as top-level and reports the contract as
 * violated by types that are perfectly correct — which is how a check like
 * this ends up deleted rather than fixed.
 */
const topLevelKeys = (literal: string): string[] => {
  const keys: string[] = [];
  let depth = 0;
  let token = "";
  for (const char of literal) {
    if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") depth -= 1;
    else if (char === ":" && depth === 1) {
      const match = /(?:readonly\s+)?(\w+)\s*\??\s*$/.exec(token);
      if (match?.[1] !== undefined) keys.push(match[1]);
      token = "";
      continue;
    } else if (char === ";" || char === ",") token = "";
    if (depth === 1) token += char;
  }
  return keys;
};

/** The body of `type <name> = { … }`, brace-matched. Empty when not found. */
const declarationOf = (source: string, name: string): string => {
  const start = new RegExp(`type\\s+${name}\\s*=\\s*\\{`).exec(source);
  if (start === null) return "";
  const open = source.indexOf("{", start.index);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return "";
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

describe("response shapes match the contract", () => {
  const contract = responseProperties();

  test("the contract was actually loaded", () => {
    expect(contract.size).toBeGreaterThan(5);
    expect(contract.get("listDashboards")).toBeDefined();
  });

  test("every property read off a response exists in that operation's schema", () => {
    const problems: string[] = [];

    for (const file of sourceFiles(APP)) {
      const source = readFileSync(file, "utf8");

      // `const { data } = await api<Shape>("operationId"` — the console's one
      // way of calling the API. An inline shape (`api<{ items: … }>`) is
      // already honest about what it expects, so both forms are covered.
      for (const call of source.matchAll(/api<([^>]+)>\(\s*"([A-Za-z0-9_]+)"/g)) {
        const declared = call[1] ?? "";
        const operationId = call[2] ?? "";
        const known = contract.get(operationId);
        if (known === undefined) continue;

        // Inline object type: check its keys directly.
        const inlineKeys = topLevelKeys(declared);
        // Named type: find its declaration and brace-match it. A regex
        // terminator cannot do this — `type Project = { … };` sits on one
        // line, so a `\n};` terminator swallows the next declaration whole and
        // reports its properties as belonging to this one.
        const namedKeys = topLevelKeys(declarationOf(source, declared.trim()));

        for (const key of [...inlineKeys, ...namedKeys]) {
          if (key === "" || known.has(key)) continue;
          problems.push(
            `${file.slice(APP.length + 1)}: ${operationId} has no "${key}" — contract says {${[...known].join(", ")}}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
