import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/aptabase.ts", "src/auto-track.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
});
