import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: ["src/index.ts", "src/aptabase.ts", "src/auto-track.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
});
