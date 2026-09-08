import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const config = createRequire(import.meta.url)("../../.dependency-cruiser.cjs") as {
  options: { exclude: { path: string } };
};
const excluded = new RegExp(config.options.exclude.path);

describe("architecture build-output exclusion boundaries", () => {
  test("excludes default and arbitrarily named isolated Next outputs only at app roots", () => {
    for (const app of ["web", "docs"]) {
      for (const directory of [".next", ".next-launch", ".next-identity-privacy", ".next-container-review-42"]) {
        expect(excluded.test(`apps/${app}/${directory}/types/validator.ts`)).toBe(true);
      }
      expect(excluded.test(`apps/${app}/next-env.d.ts`)).toBe(true);
    }
  });

  test("continues scanning source and referenced vendor types with similar names", () => {
    for (const file of [
      "apps/web/src/.next-identity-privacy/validator.ts", "apps/web/.nextish/validator.ts",
      "apps/api/.next-review/validator.ts", "apps/web/src/next-env.d.ts",
      "apps/web/next-env.d.tsx", "packages/analytics/domain/src/analysis.ts",
      "node_modules/next/dist/server/index.d.ts", "node_modules/vendor/.next-review/types/index.d.ts",
    ]) expect(excluded.test(file)).toBe(false);
  });
});
