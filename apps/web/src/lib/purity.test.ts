/**
 * The web app has no privileged path.
 *
 * "If the UI can do it, the public API can do it" is the whole point of the
 * split, and it is a property that decays silently: one `import { db }` in one
 * server component and the console can do something no integrator can, while
 * everything still builds and every test still passes.
 *
 * So it is checked mechanically. The design is explicit that this test, not
 * discipline, is the guarantee.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APP = join(import.meta.dir, "../..");
const ROOT = join(APP, "../..");

const sourceFiles = (): readonly string[] => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) found.push(path);
    }
  };
  walk(join(APP, "src"));
  return found;
};

const manifest = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(APP, "package.json"), "utf8")) as Record<string, unknown>;

describe("no database, at all", () => {
  /**
   * Named rather than pattern-matched, because the failure being prevented is
   * specific: a driver, a connection string, or an ORM appearing in this app
   * means somebody has given the console a way around the API.
   */
  const FORBIDDEN = ["drizzle-orm", "from \"pg\"", "from 'pg'", "DATABASE_URL", "@counted/adapter-postgres"];

  test("no source file reaches for one", () => {
    const found: { file: string; needle: string }[] = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const needle of FORBIDDEN) {
        // This test names them all, so it must not match itself.
        if (file.endsWith("purity.test.ts")) continue;
        if (source.includes(needle)) found.push({ file: file.slice(ROOT.length + 1), needle });
      }
    }
    expect(found).toEqual([]);
  });

  test("no dependency is a database driver", () => {
    const declared = {
      ...(manifest()["dependencies"] as Record<string, string> | undefined),
      ...(manifest()["devDependencies"] as Record<string, string> | undefined),
    };
    const offenders = Object.keys(declared).filter((name) =>
      ["pg", "drizzle-orm", "postgres", "@counted/adapter-postgres", "mysql2"].includes(name),
    );
    expect(offenders).toEqual([]);
  });

  test("the check is not vacuous", () => {
    // Otherwise "no source files found" would satisfy it forever.
    expect(sourceFiles().length).toBeGreaterThan(3);
  });
});

describe("no domain logic", () => {
  /**
   * The rule from the design: web may compute *presentation* — number
   * formatting, chart scales, relative timestamps. It may not compute
   * entitlements, quota state, permissions, query results, or defaults. All of
   * those arrive from the API, so the upgrade banner is server-decided rather
   * than a second opinion that can disagree with billing.
   */
  test("nothing imports the domain", () => {
    const importers = sourceFiles().filter(
      (file) => !file.endsWith("purity.test.ts") && readFileSync(file, "utf8").includes("@counted/domain"),
    );
    expect(importers.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  test("the contracts package is the only shared dependency", () => {
    // Contracts is schemas and the operation table — the description of the
    // API, which a client is supposed to have. Anything else from the
    // workspace would be logic this app should be asking for instead.
    const dependencies = Object.keys((manifest()["dependencies"] as Record<string, string>) ?? {});
    const internal = dependencies.filter((name) => name.startsWith("@counted/"));
    expect(internal).toEqual(["@counted/contracts"]);
  });
});

describe("one way to the network", () => {
  test("no source file calls fetch directly except the client and the callback", () => {
    // Two exceptions, both deliberate: `lib/api.ts` *is* the client, and the
    // magic-link callback re-emits the API's own Set-Cookie, which the client
    // deliberately does not model.
    const allowed = ["src/lib/api.ts", "src/app/auth/callback/route.ts"];
    const offenders = sourceFiles()
      .map((file) => ({ file, relative: file.slice(APP.length + 1) }))
      .filter(({ relative }) => !allowed.includes(relative) && !relative.endsWith("purity.test.ts"))
      .filter(({ file }) => /\bfetch\s*\(/.test(readFileSync(file, "utf8")));

    expect(offenders.map((o) => o.relative)).toEqual([]);
  });

  test("every operation the app calls exists in the contract", async () => {
    // A typo in an operation name would otherwise surface as a runtime throw
    // on whichever page nobody opened before release.
    const { OPERATIONS } = await import("@counted/contracts");
    const known = new Set(Object.values(OPERATIONS).map((o) => o.operationId));

    const called: { file: string; operationId: string }[] = [];
    for (const file of sourceFiles()) {
      if (file.endsWith("purity.test.ts") || file.endsWith("api.ts")) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\b(?:api|browserApi\(\))\s*<[^>]*>?\s*\(\s*"([a-zA-Z]+)"/g)) {
        if (match[1] !== undefined) called.push({ file: file.slice(APP.length + 1), operationId: match[1] });
      }
      for (const match of source.matchAll(/\(\s*"([a-zA-Z]+)"\s*,\s*\{\s*(?:body|params|query)/g)) {
        if (match[1] !== undefined) called.push({ file: file.slice(APP.length + 1), operationId: match[1] });
      }
    }

    expect(called.length).toBeGreaterThan(0);
    expect(called.filter((c) => !known.has(c.operationId))).toEqual([]);
  });
});
