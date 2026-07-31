import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * The console.
 *
 * There is deliberately no rewrite, no proxy and no server action reaching a
 * database here. Everything the UI can do, the public API can do — which is
 * only true for as long as the UI has no private path, so it has none.
 */
const config: NextConfig = {
  reactStrictMode: true,
  // Emits `.next/standalone` — a self-contained server with only the modules
  // it actually imports. Without it the deploy image has nothing to copy, and
  // the build fails at COPY rather than at anything that names the cause.
  output: "standalone",
  // The app lives in a workspace, so tracing has to start at the repo root or
  // the standalone bundle misses the packages it imports from there.
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  // The API is a different origin and answers with its own headers. Nothing
  // here should be caching a signed-in response.
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "x-content-type-options", value: "nosniff" },
        { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
      ],
    },
  ],
};

export default config;
