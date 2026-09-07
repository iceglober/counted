/**
 * The invariant, asserted against the source rather than against one function.
 *
 * `the-console-holds-no-credential` in `.dependency-cruiser.cjs` stops this app
 * importing a server-side package. It cannot stop someone reading
 * `STRIPE_SECRET_KEY` out of the environment and putting it in an
 * `Authorization` header by hand, because that is three lines of plain
 * TypeScript with no import in it. This is the test for that.
 *
 * Two rules, and the first is the one that matters:
 *
 *   1. No environment variable this app reads may be credential-shaped. That
 *      holds however the codebase grows and needs no maintenance.
 *   2. The set it reads today is a small, explicit set of deployment URLs. Adding another is then a
 *      deliberate edit to this file, seen in review, rather than a line in a
 *      page nobody diffed.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCE_ROOT = join(import.meta.dir, "..");

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(entry) ? [path] : [];
  });

const files = sourceFiles(SOURCE_ROOT);

/** Every spelling of an environment read: dotted, bracketed, and via a parameter. */
const environmentNames = (source: string): readonly string[] => [
  ...source.matchAll(/(?:process\.env|\benv)(?:\.([A-Z][A-Z0-9_]{2,})|\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\])/g),
].map((match) => match[1] ?? match[2] ?? "");

const CREDENTIAL_SHAPED = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|SIGNING|SALT)/;

const ALLOWED_ENVIRONMENT = ["COUNTED_API_URL", "COUNTED_CONSOLE_URL", "COUNTED_DOCS_URL", "COUNTED_PUBLIC_API_URL", "COUNTED_SITE_URL"];

describe("the console holds no credential of its own", () => {
  test("no environment variable it reads is credential-shaped", () => {
    const offenders = files.flatMap((path) =>
      environmentNames(readFileSync(path, "utf8"))
        .filter((name) => CREDENTIAL_SHAPED.test(name))
        .map((name) => `${path}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  test("it reads only the explicitly allowed deployment URLs", () => {
    const read = new Set(files.flatMap((path) => environmentNames(readFileSync(path, "utf8"))));
    expect([...read].sort()).toEqual(ALLOWED_ENVIRONMENT);
  });

  test("it imports nothing that could hold a credential", () => {
    // Belt to dependency-cruiser's braces. These are the packages whose whole
    // job is to hold a secret: the auth provider, the payment provider, the
    // database driver, and every adapter in the tree.
    const forbidden =
      /from\s+["'](better-auth|@better-auth\/[^"']+|stripe|pg|resend|@counted\/(authorization|[^"'/]*adapter[^"'/]*|[^"']*-(domain|app))[^"']*)["']/;
    const offenders = files.filter((path) => forbidden.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  test("the proxy's outbound headers are computed from the inbound ones only", () => {
    // The narrow version of the same claim: the module that builds the upstream
    // request contains no header literal that could carry a secret.
    const proxy = readFileSync(join(SOURCE_ROOT, "app", "api", "[...path]", "route.ts"), "utf8");
    expect(proxy).not.toMatch(/authorization["']?\s*:/i);
    expect(proxy).not.toMatch(/["']x-api-key["']/i);
    expect(proxy).toMatch(/forwardedRequestHeaders\(request\.headers\)/);
  });
});
