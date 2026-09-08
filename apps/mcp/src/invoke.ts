/**
 * Calling a contract procedure on the caller's behalf.
 *
 * This server does not decide anything. It takes the token the MCP client
 * presented, puts it on the request unchanged, and sends the request to the
 * same HTTP route the console and the SDKs call. Whether the call is allowed is
 * answered once, in `apps/api`, by `packages/authorization` — which is why
 * there is no permission check anywhere in this package and why a 403 is
 * reported to the agent rather than pre-empted.
 *
 * The request is built from the route's own `openapi()` meta: the method, the
 * `{braces}` in the path, and the declared `queryStyles`. Nothing is guessed.
 * A query parameter is spelled the way the contract says it is spelled, and a
 * style this file cannot encode fails at import (see `projection.ts`) rather
 * than sending a parameter the API decodes as something else.
 */

import { err, ok, type Result } from "@counted/kernel";
import type { QueryStyle, Tool } from "./projection";

/** Why a request could not even be built. Always a bug in the contract or the arguments, never a refusal. */
export type RequestBuildFailure =
  | { readonly kind: "MissingPathParam"; readonly param: string }
  | { readonly kind: "UnusablePathParam"; readonly param: string; readonly received: string }
  | {
      /**
       * A GET carrying a field that is neither a path parameter nor a declared
       * query parameter. oRPC's compact input structure would have put it in the
       * query string; we refuse instead of inventing a spelling for it.
       */
      readonly kind: "UndeclaredQueryParam";
      readonly field: string;
    };

/** What came back. Three outcomes, because they need three different things said to the agent. */
export type InvocationOutcome =
  /** The API answered. `body` is the procedure's declared output. */
  | { readonly kind: "answered"; readonly status: number; readonly body: unknown }
  /**
   * The API refused, in the oRPC error shape: a code from the closed 22, the
   * status it maps to, and the domain reason inside `data`. A 401 and a 403 are
   * both refusals — this server reports them, it does not reinterpret them.
   */
  | {
      readonly kind: "refused";
      readonly status: number;
      readonly code: string;
      readonly message: string;
      readonly data: unknown;
    }
  /** The API could not be reached or did not speak JSON. Not the caller's fault. */
  | { readonly kind: "unreachable"; readonly because: string };

export type Invocation = {
  readonly tool: Tool;
  readonly args: Readonly<Record<string, unknown>>;
  /** The caller's bearer token, forwarded verbatim. `undefined` means the tool takes no credential. */
  readonly token: string | undefined;
};

/**
 * The seam. One method, so a test can drive `server.ts` without a network and
 * so the transport can be replaced without touching the projection.
 */
export interface ContractInvoker {
  invoke(invocation: Invocation): Promise<InvocationOutcome>;
}

/** GET and HEAD cannot carry a body; their non-path input goes in the query string. */
const isBodyless = (method: string): boolean => method === "GET" || method === "HEAD";

/**
 * Encodes one query parameter the way oRPC's OpenAPI handler decodes it.
 *
 * The table is oRPC's, read out of `@orpc/openapi`'s `queryStyles`
 * documentation rather than remembered:
 *
 *   primitive               ?a=1                (last occurrence wins)
 *   array                   ?a=1&a=2
 *   comma-delimited-array   ?a=1,2,3
 *   comma-delimited-object  ?a=A,1,B,2
 *   json                    ?a={"k":"v"}
 */
export const appendQuery = (
  params: URLSearchParams,
  name: string,
  style: QueryStyle,
  value: unknown,
): void => {
  switch (style) {
    case "primitive":
      params.append(name, String(value));
      return;
    case "array":
      for (const item of Array.isArray(value) ? value : [value]) params.append(name, String(item));
      return;
    case "comma-delimited-array":
      params.append(name, (Array.isArray(value) ? value : [value]).map(String).join(","));
      return;
    case "comma-delimited-object":
      params.append(
        name,
        Object.entries(value as Record<string, unknown>)
          .flatMap(([key, item]) => [key, String(item)])
          .join(","),
      );
      return;
    case "json":
      params.append(name, JSON.stringify(value));
      return;
  }
};

/**
 * Builds the HTTP request for one tool call. Pure — no clock, no network — so
 * the spelling of every parameter is testable without a server.
 */
export const buildRequest = (
  baseUrl: string,
  invocation: Invocation,
): Result<Request, RequestBuildFailure> => {
  const { tool, args, token } = invocation;

  let path = tool.route.path;
  for (const param of tool.route.pathParams) {
    const value = args[param];
    if (value === undefined || value === null) return err({ kind: "MissingPathParam", param });
    if (typeof value !== "string" && typeof value !== "number") {
      return err({ kind: "UnusablePathParam", param, received: typeof value });
    }
    path = path.replace(`{${param}}`, encodeURIComponent(String(value)));
  }

  const query = new URLSearchParams();
  const body: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(args)) {
    if (tool.route.pathParams.includes(field)) continue;
    if (value === undefined) continue;
    const style = tool.route.query[field];
    if (style !== undefined) {
      appendQuery(query, field, style, value);
      continue;
    }
    if (isBodyless(tool.route.method)) return err({ kind: "UndeclaredQueryParam", field });
    body[field] = value;
  }

  const search = query.toString();
  const url = `${baseUrl.replace(/\/$/, "")}${path}${search === "" ? "" : `?${search}`}`;

  const headers = new Headers({ accept: "application/json" });
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);

  if (isBodyless(tool.route.method)) {
    return ok(new Request(url, { method: tool.route.method, headers }));
  }
  headers.set("content-type", "application/json");
  return ok(new Request(url, { method: tool.route.method, headers, body: JSON.stringify(body) }));
};

/** The oRPC error body: `{ defined, inferable, code, status, message, data? }`. */
const asRefusal = (status: number, body: unknown): InvocationOutcome => {
  if (typeof body === "object" && body !== null) {
    const { code, message, data } = body as { code?: unknown; message?: unknown; data?: unknown };
    if (typeof code === "string") {
      return {
        kind: "refused",
        status,
        code,
        message: typeof message === "string" ? message : code,
        data,
      };
    }
  }
  return {
    kind: "refused",
    status,
    code: `HTTP_${status}`,
    message: `The API answered ${status} without an error body.`,
    data: body,
  };
};

export type HttpInvokerOptions = {
  /** Base URL of `apps/api`, e.g. `https://api.counted.dev`. */
  readonly baseUrl: string;
  /** Injected so tests need no server, and so a deployment can add tracing. */
  readonly fetch: typeof globalThis.fetch;
  /** How long one call may take before it is reported as unreachable. */
  readonly timeoutMs: number;
};

/**
 * The shipped invoker: the contract's own HTTP routes, with the caller's token.
 *
 * There is deliberately no second credential. This server holds nothing of its
 * own — if the caller's token cannot do it, neither can this server, which is
 * the same property `apps/web` is held to.
 */
export const httpInvoker = (options: HttpInvokerOptions): ContractInvoker => ({
  async invoke(invocation) {
    const built = buildRequest(options.baseUrl, invocation);
    if (!built.ok) {
      return {
        kind: "unreachable",
        because: `${invocation.tool.name}: ${describeBuildFailure(built.error)}`,
      };
    }

    let response: Response;
    try {
      response = await options.fetch(built.value, {
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (cause) {
      return {
        kind: "unreachable",
        because: cause instanceof Error ? cause.message : String(cause),
      };
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text !== "") {
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          kind: "unreachable",
          because: `The API answered ${response.status} with a body that is not JSON.`,
        };
      }
    }

    return response.ok
      ? { kind: "answered", status: response.status, body: parsed }
      : asRefusal(response.status, parsed);
  },
});

export const describeBuildFailure = (failure: RequestBuildFailure): string => {
  switch (failure.kind) {
    case "MissingPathParam":
      return `the route needs \`${failure.param}\` in its path and the call did not carry one`;
    case "UnusablePathParam":
      return `\`${failure.param}\` must be a string or a number, not a ${failure.received}`;
    case "UndeclaredQueryParam":
      return `\`${failure.field}\` has no declared query spelling and the route cannot carry a body`;
  }
};
