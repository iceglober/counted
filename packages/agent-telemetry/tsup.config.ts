import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
  },
  {
    // The hook binary is bundled with everything inlined: it runs from a
    // plugin directory that has no node_modules, so an unresolved import is a
    // hook that never runs and never says why.
    entry: { "counted-agent": "src/cli.ts" },
    outDir: "bin",
    outExtension: () => ({ js: ".mjs" }),
    format: ["esm"],
    noExternal: [/.*/],
    banner: { js: "#!/usr/bin/env node" },
    clean: false,
  },
]);
