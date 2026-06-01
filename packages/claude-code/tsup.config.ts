import { defineConfig } from "tsup";

export default defineConfig([
  // Library build — @counted/sdk stays external (peer dependency).
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["@counted/sdk"],
  },
  // Plugin hook script — a single zero-dependency ESM file with @counted/sdk
  // bundled in, so it runs at a plugin install site with no node_modules.
  {
    entry: { "counted-hook": "src/hook.ts" },
    outDir: "bin",
    format: ["esm"],
    dts: false,
    sourcemap: false,
    clean: false,
    noExternal: ["@counted/sdk"],
    outExtension: () => ({ js: ".mjs" }),
  },
]);
