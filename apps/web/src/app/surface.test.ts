/**
 * Where things live.
 *
 * #67 is three structural claims — Settings holds account and billing only,
 * monitors live at project scope, and there is no second project selector —
 * and all three decay the same way: somebody adds a control to the page they
 * happen to be editing. None of them is visible in a unit test of a component,
 * because each is a statement about the *set* of pages.
 *
 * So they are checked against the routes themselves.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APP = join(import.meta.dir, "..", "..");
const pageAt = (route: string): string => readFileSync(join(APP, "src/app", route), "utf8");

const routeFiles = (): readonly string[] => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "page.tsx" || entry.name === "route.ts") found.push(path);
    }
  };
  walk(join(APP, "src/app"));
  return found;
};

describe("Settings holds account and billing only", () => {
  const settings = () => pageAt("settings/page.tsx");

  test("it does not list, create or configure monitors", () => {
    // v1's Settings had an alerts tab. A monitor watches one project's events,
    // and the page about a project is where it belongs.
    const source = settings();
    for (const name of ["listMonitors", "updateMonitor", "MonitorTable"]) {
      expect({ name, present: source.includes(name) }).toMatchObject({ present: false });
    }
  });

  test("it does not list or issue credentials", () => {
    // Keys belong to a project too, for the same reason.
    const source = settings();
    expect(source).not.toContain("listCredentials");
    expect(source).not.toContain("issueCredential");
  });

  test("it does read the two things it is for", () => {
    // Otherwise "Settings does nothing" would satisfy every test above.
    const source = settings();
    expect(source).toContain("getSubscription");
    expect(source).toContain("getUsage");
  });
});

describe("monitors are at project scope", () => {
  test("the project page is the only page that lists them", () => {
    const listing = routeFiles().filter((file) => readFileSync(file, "utf8").includes("listMonitors"));
    expect(listing.map((f) => f.slice(APP.length + 1))).toEqual(["src/app/projects/[projectId]/page.tsx"]);
  });

  test("and it does list them, so the check is not vacuous", () => {
    expect(pageAt("projects/[projectId]/page.tsx")).toContain("MonitorTable");
  });
});

describe("there is one project context, not two", () => {
  /**
   * The bug this replaces: v1's Settings carried its own project `<select>`
   * alongside the shell's, so the alert you created could belong to a project
   * other than the one on screen — and nothing on the alert said which.
   *
   * A project is chosen by navigating to it. There is no picker anywhere.
   */
  test("no page renders a project selector", () => {
    const offenders = routeFiles().filter((file) => {
      const source = readFileSync(file, "utf8");
      return /<select[^>]*project/i.test(source) || /projectId\s*,\s*set[A-Z]/.test(source);
    });
    expect(offenders.map((f) => f.slice(APP.length + 1))).toEqual([]);
  });

  test("the project page takes its project from the path, not from state", () => {
    const source = pageAt("projects/[projectId]/page.tsx");
    expect(source).toContain("params: Promise<{ projectId: string }>");
    expect(source).not.toContain("useState");
  });

  test("workspace-scoped pages take the workspace from the shell's context", () => {
    // One helper, `workspaceFrom`, which checks the requested id against what
    // the caller may actually see. A page reading `?workspace=` directly would
    // be a second, unchecked path to the same decision.
    for (const route of ["projects/page.tsx", "settings/page.tsx"]) {
      const source = pageAt(route);
      expect({ route, uses: source.includes("workspaceFrom(caller") }).toMatchObject({ uses: true });
    }
  });
});

describe("no page decides an entitlement for itself", () => {
  test("nothing compares a plan name to choose what to show", () => {
    // v1 had three rival "is pro" checks. The server decides; the page renders
    // what it is told, so an upgrade banner cannot disagree with billing.
    // Both directions. The first version of this only matched a literal on
    // the left, so `plan === "pro"` — the way anybody would actually write it
    // — walked straight through.
    const comparison = /(["'](?:pro|free)["']\s*[!=]==?)|([!=]==?\s*["'](?:pro|free)["'])/;
    const offenders = routeFiles().filter((file) => comparison.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => f.slice(APP.length + 1))).toEqual([]);
  });

  test("nothing recomputes whether a monitor is breaching", () => {
    // The server sends `state`. Deriving it here from lastValue and a
    // threshold would be a second opinion, free to disagree with the one that
    // actually sends the notifications.
    const components = join(APP, "src/components/monitors.tsx");
    expect(existsSync(components)).toBe(true);
    const source = readFileSync(components, "utf8");

    // A property access, not the word — which appears in the prose explaining
    // why it is absent, and a substring check over the whole file would fail
    // on its own comment.
    expect(source).not.toMatch(/\.threshold\b/);
    // Any comparison of the reading, not just one written tightly. A first
    // version required the operator immediately after `lastValue`, so
    // `(monitor.lastValue ?? 0) > 100` escaped it.
    expect(source).not.toMatch(/lastValue[\s\S]{0,20}[<>]=?\s*\d/);
    // And the rendered cell is the server's own verdict. Asserting only that
    // `monitor.state` appears somewhere was not enough — it survived in a
    // style attribute while the cell itself was recomputed.
    expect(source).toMatch(/STATE_LABEL\[monitor\.state\]/);
  });
});
