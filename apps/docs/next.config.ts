import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  distDir: process.env.COUNTED_NEXT_DIST_DIR ?? ".next",
  experimental: {
    // Clean container builds never restore .next/cache; avoid retaining and
    // persisting a build cache that the next build cannot reuse.
    turbopackFileSystemCacheForBuild: process.env.COUNTED_NEXT_BUILD_CACHE !== "off",
  },
  transpilePackages: ["@counted/ui", "@counted/openapi"],
  poweredByHeader: false,
  devIndicators: false,
  agentRules: false,
};
export default config;
