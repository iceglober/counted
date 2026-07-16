import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/aptabase.tsx"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "@counted/sdk"],
  // Client components: the built files use React hooks/effects.
  banner: { js: '"use client";' },
});
