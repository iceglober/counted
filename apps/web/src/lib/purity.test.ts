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
      // Test files are excluded here rather than by each check separately.
      // These gates are about what the *app* does, and a test that describes a
      // rule necessarily contains the strings the rule looks for — a file
      // asserting "no page may call listMonitors" was itself reported as a
      // page calling listMonitors. Some checks below filtered test files and
      // others forgot, so a new test file tripped whichever had forgotten.
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
        found.push(path);
      }
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

  test("only the contract and the public SDK come from the workspace", () => {
    /**
     * Two, and the second needs justifying.
     *
     * `@counted/contracts` is schemas and the operation table — the
     * description of the API, which a client is supposed to have.
     *
     * `@counted/sdk-js` is the SDK **any customer installs**, used here for
     * the same thing they use it for: sending events to the public ingest
     * endpoint with a public key. It is the least privileged path in the
     * system, not a private one, and Counted measuring its own marketing site
     * with its own product is the point.
     *
     * Anything else from the workspace would be logic this app should be
     * asking the API for.
     */
    const dependencies = Object.keys((manifest()["dependencies"] as Record<string, string>) ?? {});
    const internal = dependencies.filter((name) => name.startsWith("@counted/")).sort();
    expect(internal).toEqual(["@counted/contracts", "@counted/sdk-js"]);
  });

  test("the SDK is used to write events, never to read data", () => {
    /**
     * The teeth. Allowing the SDK must not become a second way to *read* —
     * a page that pulled a dashboard through the SDK would be doing something
     * an integrator could not, which is the whole invariant.
     *
     * The SDK's own surface makes this nearly structural (it has `track`,
     * `identify`, `reset`, `flush` and nothing that fetches), but naming it
     * means a future read method cannot quietly arrive here.
     */
    const users = sourceFiles().filter(
      (file) => !file.endsWith("purity.test.ts") && readFileSync(file, "utf8").includes("@counted/sdk-js"),
    );
    expect(users.length).toBeGreaterThan(0);
    for (const file of users) {
      const source = readFileSync(file, "utf8");
      // Only the constructor and the write-side calls.
      const calls = [...source.matchAll(/counted\.(\w+)\(/g)].map((m) => m[1]);
      for (const call of calls) {
        expect({ file: file.slice(APP.length + 1), call }).toMatchObject({
          call: expect.stringMatching(/^(track|identify|reset|flush|shutdown)$/),
        });
      }
    }
  });
});

describe("one way to the network", () => {
  test("no source file reaches the API except through the client", () => {
    /**
     * The invariant is about the *app* reaching the API, not about the word.
     *
     * Marketing pages, the docs and the agent prompt all name the endpoint —
     * that is what documentation is for, and a docs page that could not print
     * a URL would be a poor one. An exception list for each of them grows
     * until it means nothing, so the check is precise instead: a file is only
     * reaching the API if it *both* names the base URL and calls `fetch`.
     *
     * Prose has no fetch. A page that started making its own requests would
     * have both, and would fail here.
     *
     * The allowances are the client itself, and the two routes that re-emit
     * the API's own `Set-Cookie` — the magic-link callback, which receives a
     * session, and sign-out, which receives its expiry. Passing that header
     * through is exactly what the client does not model: it returns parsed
     * data, and a cookie is neither parsed nor data. Rebuilding one here would
     * be a second description of what a session is.
     *
     * Both are server-only route handlers reached by top-level navigation, so
     * neither is a page quietly growing its own transport.
     */
    const allowed = [
      "src/lib/api.ts",
      "src/app/auth/callback/route.ts",
      "src/app/sign-out/route.ts",
    ];
    const namesApi = /(publicApiUrl|serverApiUrl)\s*\(|API_URL|https?:\/\/[^"'`\s]*counted[^"'`\s]*\/v1\//;
    const callsFetch = /\bfetch\s*\(/;

    const offenders = sourceFiles()
      .map((file) => ({ file, relative: file.slice(APP.length + 1) }))
      .filter(({ relative }) => !allowed.includes(relative) && !/\.test\.tsx?$/.test(relative))
      .filter(({ file }) => {
        const source = readFileSync(file, "utf8");
        return namesApi.test(source) && callsFetch.test(source);
      });

    expect(offenders.map((o) => o.relative)).toEqual([]);
  });

  test("a same-origin fetch never carries a credential", () => {
    // The other half. A BFF call is fine; a BFF call that builds an
    // `Authorization` header in the browser is the share token escaping into
    // page JavaScript.
    const offenders = sourceFiles()
      .filter((file) => !file.endsWith("purity.test.ts") && !file.endsWith("api.ts"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return source.includes('"use client"') && /authorization\s*:/i.test(source);
      });
    expect(offenders.map((f) => f.slice(APP.length + 1))).toEqual([]);
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

describe("the public copy teaches the current contract", () => {
  /**
   * `/api/v0/*` is the Aptabase compatibility edge. It exists so a shipped
   * mobile app can keep sending events, it is marked deprecated in the spec,
   * and it answers 410 for everything except ingest.
   *
   * The marketing pages, the docs, the llms.txt routes and the agent metadata
   * all inherited v1's copy, which taught it as *the* integration path — so an
   * agent or a developer following the instructions would have integrated
   * against the deprecated edge by accident, and the landing page's own call
   * to action called a route that does not exist in v2 at all.
   *
   * Checked because every one of those files reads like prose and none of them
   * would fail a build.
   */
  test("nothing advertises the v0 compat edge", () => {
    const offenders: { file: string; line: string }[] = [];
    for (const file of sourceFiles()) {
      if (file.endsWith("purity.test.ts")) continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        // A path, not the word — the comment explaining why it is absent says
        // `/api/v0/` too, and flagging that would be flagging the fix.
        if (/["'`\s(]\/api\/v0\//.test(line) && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")) {
          offenders.push({ file: file.slice(APP.length + 1), line: line.trim().slice(0, 70) });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("and the endpoints it does name are ones the API serves", async () => {
    // Otherwise "advertise nothing" would satisfy the check above.
    const { OPERATIONS } = await import("@counted/contracts");
    const served = new Set(Object.keys(OPERATIONS).map((k) => k.split(" ")[1]));

    /**
     * The collection segment only — `/v1/events`, `/v1/workspaces`.
     *
     * A first version matched deeper and mangled every example carrying a
     * concrete id: `/v1/workspaces/ws_123/projects` came out as
     * `/v1/workspaces/ws`, which is in no route table and never will be. The
     * collection is the part that is stable across every example, and it is
     * enough to catch an endpoint that does not exist.
     */
    const named = new Set<string>();
    for (const file of sourceFiles()) {
      if (file.endsWith("purity.test.ts")) continue;
      for (const match of readFileSync(file, "utf8").matchAll(/\/v1\/([a-z][a-z-]*)/g)) {
        if (match[1] !== undefined) named.add(`/v1/${match[1]}`);
      }
    }

    expect(named.size).toBeGreaterThan(2);
    for (const path of named) {
      const known = [...served].some((s) => s !== undefined && (s === path || s.startsWith(`${path}/`) || s.startsWith(path)));
      expect({ path, known }).toMatchObject({ known: true });
    }
  });
});
