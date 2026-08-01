/**
 * The console has navigation, and it points at pages that exist.
 *
 * It had neither. Signing in landed on a project page rendering a bare
 * `<main>` — no link to dashboards, none to settings, no way to sign out. The
 * app was navigable only by typing URLs, which reads as broken because it
 * effectively is.
 *
 * Two things are asserted, because each failed independently today:
 *
 * 1. **Every console section is wrapped.** The chrome is a thin `layout.tsx`
 *    per section rather than a route group, so a new section gets no
 *    navigation unless somebody remembers. This is what remembers.
 *
 * 2. **Every nav link resolves.** `/sign-out` was linked before it existed —
 *    the same dead-URL pattern as `/index.md`, `/v1/openapi.json` and the 401
 *    `resource_metadata`, and the worst possible place for it, since it is
 *    where somebody goes to be certain they are signed out.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APP = join(import.meta.dir, "..", "app");
const chrome = readFileSync(join(import.meta.dir, "console-chrome.tsx"), "utf8");

/** Sections behind auth. Marketing and docs have their own chrome. */
const CONSOLE_SECTIONS = ["dashboards", "projects", "settings", "start"];

describe("console chrome", () => {
  for (const section of CONSOLE_SECTIONS) {
    test(`/${section} is wrapped in the console shell`, () => {
      const layout = join(APP, section, "layout.tsx");
      expect(existsSync(layout)).toBe(true);
      expect(readFileSync(layout, "utf8")).toContain("ConsoleShell");
    });
  }

  test("the sections listed here are the ones that actually exist", () => {
    // Otherwise this file drifts from the app and the loop above starts
    // checking a set that no longer matches reality.
    const onDisk = readdirSync(APP, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("(") && !e.name.startsWith("."))
      .map((e) => e.name)
      .filter((name) => existsSync(join(APP, name, "page.tsx")));

    const behindAuth = onDisk.filter(
      (name) => !["docs", "sign-in", "claim", "share", "auth", "sign-out"].includes(name),
    );
    expect(behindAuth.sort()).toEqual([...CONSOLE_SECTIONS].sort());
  });

  test("every nav link points at something served", () => {
    const hrefs = [...chrome.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1] ?? "");
    expect(hrefs.length).toBeGreaterThan(3);

    for (const href of hrefs) {
      const segment = href.replace(/^\//, "").split("?")[0] ?? "";
      const dir = join(APP, segment);
      const served = existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "route.ts"));
      expect({ href, served }).toEqual({ href, served: true });
    }
  });
});
