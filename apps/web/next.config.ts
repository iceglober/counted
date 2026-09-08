import type { NextConfig } from "next";

/**
 * Two settings, both load-bearing.
 *
 * `transpilePackages` is required because the workspace packages point `main`
 * and `types` at TypeScript source — Bun runs `.ts` directly, Node does not.
 * Without this the server bundle tries to `require` a `.ts` file at runtime and
 * fails only once a page renders, which reads as a page bug rather than a build
 * one.
 *
 * `serverExternalPackages` is deliberately empty. Anything listed there is
 * loaded from `node_modules` at runtime instead of bundled, and the console has
 * no native dependency that needs it.
 */
const config: NextConfig = {
  output: "standalone",
  distDir: process.env.COUNTED_NEXT_DIST_DIR ?? ".next",
  experimental: {
    // Clean container builds never restore .next/cache; avoid retaining and
    // persisting a build cache that the next build cannot reuse.
    turbopackFileSystemCacheForBuild: process.env.COUNTED_NEXT_BUILD_CACHE !== "off",
  },
  transpilePackages: ["@counted/contract", "@counted/kernel", "@counted/ui", "@counted/openapi"],
  outputFileTracingIncludes: {
    "/design/**": ["./src/app/design/examples/*.tsx", "./src/app/design/aggregates/examples/*.tsx"],
  },
  // The console renders on the server and proxies the browser's calls. It never
  // ships an API base URL to the client, so there is no `env` block here: a
  // `NEXT_PUBLIC_*` API origin would be the first step back towards a browser
  // that talks to the API directly, and the cookie-forwarding proxy exists
  // precisely so it does not have to.
  poweredByHeader: false,
  devIndicators: false,
  // Next 16 writes `AGENTS.md` and `CLAUDE.md` into this directory on every
  // `next dev`. The repository has its own at the root, and two more that
  // regenerate on each run are untracked churn that gets committed by accident.
  agentRules: false,
};

export default config;
