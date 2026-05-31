import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["drizzle-orm", "better-auth"],
  env: {
    BUILD_ID: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7)
      ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7)
      ?? "dev",
  },
};

export default config;
