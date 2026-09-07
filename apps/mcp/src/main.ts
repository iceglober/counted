/**
 * The process. Reads the environment once, binds the port, and stops on
 * `SIGTERM`.
 *
 * Deliberately thin: everything that can be tested without a port lives in
 * `handler.ts` and below, and this file is the part that cannot. It follows
 * `apps/api/src/main.ts` in shape — refuse to start on a bad environment,
 * print why, log one JSON object per line, drain on a signal — but shares
 * none of its code, because the four deployables are independent
 * (`.dependency-cruiser.cjs`, "apps-are-independent").
 *
 * There is no database here and no state. What this process holds between
 * requests is the projected tool table, computed at import; a request is the
 * caller's token forwarded to `COUNTED_API_URL` and the answer forwarded back.
 */

import { apiVerifier } from "./authentication";
import { describeConfigFailure, readConfig } from "./config";
import { createHandler, READY_PATH } from "./handler";
import { httpInvoker } from "./invoke";
import { TOOLS } from "./projection";

const SERVICE = "counted-mcp";

type LogFields = Readonly<Record<string, string | number | boolean | null>>;

/**
 * One JSON object per line, the same shape `apps/api` writes, so one log
 * query reads both services. Nothing here ever logs a token: the fields are
 * named one by one, never spread from a request.
 */
const log = (level: "info" | "warn" | "error", message: string, fields: LogFields = {}): void => {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), level, service: SERVICE, message, ...fields })}\n`,
  );
};

const start = (): void => {
  const config = readConfig(process.env);
  if (!config.ok) {
    process.stderr.write(`config: ${describeConfigFailure(config.error)}\n`);
    process.exit(1);
  }
  const { apiUrl, port, endpoint, identity, timeoutMs } = config.value;

  const handler = createHandler({
    identity,
    endpoint,
    verifier: apiVerifier({ baseUrl: apiUrl, fetch: globalThis.fetch, timeoutMs }),
    invoker: httpInvoker({ baseUrl: apiUrl, fetch: globalThis.fetch, timeoutMs }),
    onError: (error) => log("error", "mcp handler failed", { error: error.message, errorType: error.name }),
  });

  const server = Bun.serve({ port, fetch: handler.fetch });
  log("info", "listening", {
    port,
    endpoint,
    ready: READY_PATH,
    resource: identity.resource,
    issuer: identity.issuer,
    apiUrl,
    tools: TOOLS.length,
  });

  /**
   * Stop accepting, let in-flight calls finish, then exit. No shell wrapper in
   * the image, so the signal reaches this process directly.
   */
  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log("info", "stopping", { signal });
    await server.stop();
    await handler.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
};

start();
