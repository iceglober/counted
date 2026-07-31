/**
 * Every workspace package is in the build graph.
 *
 * A package missing from `tsconfig.build.json` still typechecks — resolution
 * falls through to its source — and still runs under Bun, which reads
 * TypeScript directly. So nothing fails, and the package silently never gets
 * built. This is the same shape as an endpoint that ships undocumented: real,
 * invisible, and only found by comparing two lists nobody thought to compare.
 *
 * It lives here rather than in a script because a test is the thing that runs.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");

/** Every directory under packages/ and apps/ that has a package.json. */
const workspacePackages = (): readonly string[] => {
  const found: string[] = [];
  const walk = (relative: string, depth: number): void => {
    if (depth > 2) return;
    const absolute = join(ROOT, relative);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const child = `${relative}/${entry.name}`;
      if (existsSync(join(ROOT, child, "package.json"))) found.push(child);
      else walk(child, depth + 1);
    }
  };
  walk("packages", 0);
  walk("apps", 0);
  return found;
};

const references = (): readonly string[] => {
  const raw = readFileSync(join(ROOT, "tsconfig.build.json"), "utf8");
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as { references?: { path: string }[] };
  return (config.references ?? []).map((r) => r.path);
};

/**
 * Whether a package belongs to the v2 build.
 *
 * Depending on the domain is the test, because that is what "part of the
 * rewrite" means structurally. It leaves v1 packages — which depend on the
 * published SDK and nothing else — correctly out of scope, without an
 * allowlist that would go stale.
 */
const isV2Package = (pkg: string): boolean => {
  const manifest = JSON.parse(readFileSync(join(ROOT, pkg, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(manifest.dependencies ?? {}).includes("@counted/domain") || pkg === "packages/domain";
};

describe("the build graph covers the workspace", () => {
  test("every v2 package is referenced by the build", () => {
    const referenced = new Set(references());
    for (const pkg of workspacePackages()) {
      // No tsconfig means it is not a TypeScript project — the SDKs in other
      // languages will be like this.
      if (!existsSync(join(ROOT, pkg, "tsconfig.json"))) continue;
      if (!isV2Package(pkg)) continue;
      expect({ package: pkg, referenced: [...referenced] }).toMatchObject({
        referenced: expect.arrayContaining([pkg]),
      });
    }
  });

  test("the scoping rule actually includes the packages it should", () => {
    // Otherwise "no v2 packages found" would pass silently.
    const inScope = workspacePackages().filter(isV2Package);
    for (const expected of ["packages/domain", "packages/ports", "apps/api"]) {
      expect(inScope).toContain(expected);
    }
  });

  test("the check is not vacuous", () => {
    expect(workspacePackages().length).toBeGreaterThan(5);
    expect(references().length).toBeGreaterThan(5);
  });
});
