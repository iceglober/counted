import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const app = join(import.meta.dir, "../app");
const sourceRoot = join(import.meta.dir, "..");
const entry = readFileSync(join(app, "globals.css"), "utf8");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? files(join(dir, item.name))
      : item.name.endsWith(".tsx") && !item.name.endsWith(".test.tsx")
        ? [join(dir, item.name)]
        : [],
  );
describe("one shared component system", () => {
  test("the shared theme is the only component stylesheet", () => {
    expect(entry).toContain('@import "@counted/ui/styles.css"');
    expect(entry).toContain('@source "../../../../packages/ui/src"');
    expect(entry).not.toContain("legacy");
    expect(existsSync(join(app, "legacy.css"))).toBe(false);
    expect(readFileSync(join(app, "app.css"), "utf8")).not.toMatch(
      /--[\w-]+\s*:/,
    );
  });
  test("application surfaces use shared controls, overlays, and charts", () => {
    const offenders: string[] = [];
    for (const path of [
      ...files(join(sourceRoot, "components")),
      ...files(app).filter((path) => !path.includes("/design/")),
    ]) {
      const source = readFileSync(path, "utf8");
      if (
        /<(?:button|select|textarea|table|details|progress|svg)\b|window\.(?:confirm|alert)\(/.test(
          source,
        ) ||
        /<input\b(?![^>]*type="hidden")/.test(source)
      )
        offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
