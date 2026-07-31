import { defineConfig } from "tsup";

export default defineConfig([
  { entry: ["src/index.ts"], format: ["esm", "cjs"], dts: true, clean: true },
  {
    // Everything inlined: Claude Code runs this from the plugin directory,
    // where there is no node_modules to resolve an import against.
    entry: { "counted-hook": "src/hook.ts" },
    outDir: "bin",
    outExtension: () => ({ js: ".mjs" }),
    format: ["esm"],
    noExternal: [/.*/],
    banner: { js: "#!/usr/bin/env node" },
    clean: false,
  },
]);
