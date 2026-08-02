/**
 * Every custom property the app reads is one the app defines.
 *
 * Six were not. `--accent`, `--accent-hover`, `--border`, `--error`,
 * `--text-primary` and `--text-tertiary` were referenced by shipped CSS and
 * defined nowhere — only the Tailwind-prefixed `--color-*` forms existed — so
 * every rule using a bare name resolved to nothing.
 *
 * The failure is silent by construction, which is why it lasted. An
 * unresolvable `var()` is invalid at computed-value time: the declaration is
 * dropped and the property falls back to its initial value. For `color` that
 * is usually still legible, so nothing looks obviously broken. For
 * `stroke` — which `series-chart.tsx` sets three times — the initial value is
 * `none`, and the line is simply not drawn.
 *
 * This is the same defect class as the console that shipped with no styling:
 * the CSS was present and correct and never matched anything. A stylesheet
 * cannot fail loudly, so the check has to be external.
 *
 * Scope: `var(--x)` reads in CSS and in `.tsx` inline styles and presentation
 * attributes. Tailwind's own generated utilities are not covered — those names
 * come from `@theme` and are Tailwind's contract, not ours.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP = import.meta.dir;
const SRC = join(APP, "..");

const read = (p: string): string => readFileSync(p, "utf8");

/** Names defined anywhere — `@theme` emits its block to `:root`, so both count. */
const defined = (): Set<string> => {
  const names = new Set<string>();
  for (const file of ["globals.css", "retro.css"]) {
    for (const m of read(join(APP, file)).matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)) {
      if (m[1] !== undefined) names.add(m[1]);
    }
  }
  return names;
};

/** Names read via `var()`, and where. */
const referenced = (): Map<string, Set<string>> => {
  const refs = new Map<string, Set<string>>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(full);
        continue;
      }
      if (!/\.(css|tsx?)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      for (const m of read(full).matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,|\))/g)) {
        const name = m[1];
        if (name === undefined) continue;
        if (!refs.has(name)) refs.set(name, new Set());
        refs.get(name)?.add(full.slice(SRC.length + 1));
      }
    }
  };
  walk(SRC);
  return refs;
};

describe("custom properties", () => {
  const have = defined();
  const want = referenced();

  test("the scan found both definitions and references", () => {
    expect(have.size).toBeGreaterThan(10);
    expect(want.size).toBeGreaterThan(5);
  });

  test("every var() read resolves to a definition", () => {
    // A `var(--x, fallback)` read is safe by construction — the fallback is the
    // definition. Only bare reads can silently vanish.
    const dangling = [...want.entries()]
      .filter(([name]) => !have.has(name))
      .map(([name, files]) => `${name} <- ${[...files].sort().join(", ")}`);

    expect(dangling).toEqual([]);
  });

  test("the six that shipped undefined are defined", () => {
    // Named explicitly: the general check above would also pass if somebody
    // deleted the last reference instead of adding the definition, and that is
    // not the same fix.
    for (const name of [
      "--accent",
      "--accent-hover",
      "--border",
      "--error",
      "--text-primary",
      "--text-tertiary",
    ]) {
      expect({ name, defined: have.has(name) }).toEqual({ name, defined: true });
    }
  });
});
