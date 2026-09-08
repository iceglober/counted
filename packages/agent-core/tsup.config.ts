import { defineConfig } from "tsup";
export default defineConfig({ entry: ["src/index.ts"], format: ["esm", "cjs"], dts: { compilerOptions: { composite: false, ignoreDeprecations: "6.0" } }, sourcemap: true, clean: true, external: ["@counted/sdk"] });
