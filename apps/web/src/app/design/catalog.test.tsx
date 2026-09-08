import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { aggregates, primitives } from "./catalog";
import { exampleMap } from "./example-map";
import { exampleVariants } from "./variants";

const ui = join(import.meta.dir, "../../../../../packages/ui");

describe("Counted UI catalog", () => {
  test("every shipped primitive has a named route and a source-backed example", () => {
    const shipped = readdirSync(join(ui, "src/components"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => f.slice(0, -4))
      .sort();
    expect(shipped).toEqual(primitives.map((p) => p.id).sort());
    expect(Object.keys(exampleMap).sort()).toEqual(shipped);
    expect(new Set(primitives.map((p) => p.id)).size).toBe(primitives.length);
    for (const { id } of primitives)
      expect(existsSync(join(import.meta.dir, "examples", `${id}.tsx`))).toBe(
        true,
      );
  });

  for (const item of primitives) {
    for (const variant of exampleVariants[item.id]) {
      test(`${item.title}: ${variant} renders a standalone preview`, () => {
        const html = renderToStaticMarkup(
          createElement(exampleMap[item.id], { variant }),
        );
        expect(html.length).toBeGreaterThan(50);
        expect(html).not.toContain("[object Object]");
      });
    }
  }

  test("aggregate dependencies resolve to showcased primitives", () => {
    const ids = new Set<string>(primitives.map((p) => p.id));
    for (const item of aggregates) {
      expect(
        existsSync(
          join(import.meta.dir, "aggregates/examples", `${item.id}.tsx`),
        ),
      ).toBe(true);
      for (const dependency of item.components)
        expect(ids.has(dependency)).toBe(true);
    }
  });

  test("the shared library has no dependency on product domains or showcase composites", () => {
    const pkg = JSON.parse(readFileSync(join(ui, "package.json"), "utf8"));
    expect(
      Object.keys(pkg.dependencies).filter((name) =>
        name.startsWith("@counted/"),
      ),
    ).toEqual([]);
    expect(
      Object.keys(pkg.exports).some((path) => path.includes("aggregates")),
    ).toBe(false);
  });
});
