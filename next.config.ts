import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["drizzle-orm", "better-auth"],
};

export default config;
