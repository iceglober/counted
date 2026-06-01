import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Bundle the SDK so the published plugin is self-contained — OpenCode
  // auto-installs the package and shouldn't need to resolve extra deps.
  noExternal: ["@counted/sdk"],
});
