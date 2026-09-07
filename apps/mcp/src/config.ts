/**
 * Configuration, read once and validated before the process serves anything.
 *
 * Every field is required. There is no default for the API URL or the resource
 * identifier because a wrong guess at either is a security question, not a
 * convenience one: a defaulted resource identifier would make this server
 * accept tokens minted for somebody else's resource.
 */

import { err, ok, type Result } from "@counted/kernel";
import type { ResourceIdentity } from "./authentication";

export type Config = {
  /** Base URL of `apps/api`. Every tool call and every identity check goes here. */
  readonly apiUrl: string;
  /** Where this server listens. */
  readonly port: number;
  /** The path the MCP endpoint is served at. Must agree with the path in `resource`. */
  readonly endpoint: string;
  readonly identity: ResourceIdentity;
  /** How long one call to `apps/api` may take. */
  readonly timeoutMs: number;
};

export type ConfigFailure =
  | { readonly kind: "Missing"; readonly variable: string; readonly meaning: string }
  | { readonly kind: "NotAUrl"; readonly variable: string; readonly value: string }
  | { readonly kind: "NotANumber"; readonly variable: string; readonly value: string };

const url = (
  env: Readonly<Record<string, string | undefined>>,
  variable: string,
  meaning: string,
): Result<string, ConfigFailure> => {
  const raw = env[variable];
  if (raw === undefined || raw === "") return err({ kind: "Missing", variable, meaning });
  try {
    return ok(new URL(raw).toString().replace(/\/$/, ""));
  } catch {
    return err({ kind: "NotAUrl", variable, value: raw });
  }
};

const integer = (
  env: Readonly<Record<string, string | undefined>>,
  variable: string,
  fallback: number,
): Result<number, ConfigFailure> => {
  const raw = env[variable];
  if (raw === undefined || raw === "") return ok(fallback);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return err({ kind: "NotANumber", variable, value: raw });
  return ok(parsed);
};

export const readConfig = (
  env: Readonly<Record<string, string | undefined>>,
): Result<Config, ConfigFailure> => {
  const apiUrl = url(env, "COUNTED_API_URL", "the base URL of the Counted API");
  if (!apiUrl.ok) return apiUrl;

  const resource = url(
    env,
    "COUNTED_MCP_RESOURCE",
    "this server's public URL, which is also its OAuth resource identifier",
  );
  if (!resource.ok) return resource;

  const issuer = url(
    env,
    "COUNTED_OAUTH_ISSUER",
    "the authorization server that mints MCP access tokens — the API's /api/auth mount",
  );
  if (!issuer.ok) return issuer;

  const port = integer(env, "PORT", 3002);
  if (!port.ok) return port;

  const timeoutMs = integer(env, "COUNTED_API_TIMEOUT_MS", 30_000);
  if (!timeoutMs.ok) return timeoutMs;

  const documentation = env["COUNTED_MCP_DOCS_URL"];
  const endpoint = new URL(resource.value).pathname;

  return ok({
    apiUrl: apiUrl.value,
    port: port.value,
    endpoint: endpoint === "" ? "/" : endpoint,
    timeoutMs: timeoutMs.value,
    identity: {
      resource: resource.value,
      issuer: issuer.value,
      ...(documentation === undefined || documentation === "" ? {} : { documentation }),
    },
  });
};

export const describeConfigFailure = (failure: ConfigFailure): string => {
  switch (failure.kind) {
    case "Missing":
      return `${failure.variable} is not set. It is ${failure.meaning}.`;
    case "NotAUrl":
      return `${failure.variable} is not a URL: ${failure.value}`;
    case "NotANumber":
      return `${failure.variable} must be a positive integer, not: ${failure.value}`;
  }
};
