/**
 * Entry point.
 *
 * Composition failures — a missing DATABASE_URL, a database that disagrees
 * with the domain about bucketing — exit non-zero before the port is bound.
 * Starting and then serving wrong numbers is the outcome this prevents.
 */

import { bootLine, compose, configFromEnv } from "./composition";
import { createApp } from "./server";

const config = configFromEnv(process.env);
const deps = await compose(config);

// eslint-disable-next-line no-console
console.log(bootLine(deps));

const server = Bun.serve({ port: config.port, fetch: createApp(deps).fetch });

const stop = async (signal: string): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log(`${signal}: draining`);
  await server.stop(false);
  await deps.shutdown();
  process.exit(0);
};

process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));
