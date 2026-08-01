/**
 * The only place this app talks to the network.
 *
 * Everything the console can do, the public API can do — and that is only true
 * for as long as there is no second way to reach data. So there is one client,
 * built from the committed OpenAPI contract, and no database driver anywhere
 * in this app. A test greps for that rather than trusting it.
 *
 * Two variants, because a request from a server component and a request from a
 * browser authenticate differently:
 *
 * - `browserApi()` — `credentials: "include"`. The session cookie is set on
 *   the registrable domain, so a call from `app.counted.dev` to
 *   `api.counted.dev` carries it and `SameSite=Lax` permits it. There is no
 *   proxy hop and no second description of the API.
 * - `serverApi()` — forwards the incoming `Cookie` header verbatim, because a
 *   server component has no ambient credentials of its own.
 *
 * Neither wraps the API in a *different* API. The method names, the paths and
 * the shapes are the contract's.
 */

import { OPERATIONS, resolveTag, type OperationSpec } from "@counted/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** RFC 9457 problem details, when the API sent them. */
    readonly problem: Record<string, unknown> | null,
    readonly requestId: string | null,
  ) {
    const detail = typeof problem?.["detail"] === "string" ? problem["detail"] : `The API answered ${status}.`;
    super(detail);
    this.name = "ApiError";
  }

  /** Whether signing in again would help. Drives the redirect, not a guess. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

export type RequestOptions = {
  /** Path parameters, substituted into the operation's path template. */
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  /** Optimistic concurrency. The API answers 412 when the ETag is stale. */
  readonly ifMatch?: string;
  /**
   * A bearer credential for this one call.
   *
   * For the ingest endpoint, which authenticates with a project key rather
   * than the session. Without it the onboarding test-event button would have
   * to call `fetch` itself, and "one way to the network" would stop being
   * true the first time somebody needed a second way.
   */
  readonly bearer?: string;
  readonly signal?: AbortSignal;
};

export type ApiResponse<T> = {
  readonly data: T;
  readonly etag: string | null;
  readonly requestId: string | null;
  /** Cache tags this response is, resolved from the contract. */
  readonly provides: readonly string[];
  /** Cache tags this call made stale, resolved from the contract. */
  readonly invalidates: readonly string[];
};

/** `METHOD /path/{param}` split into the two things a fetch needs. */
const splitKey = (key: string): { method: string; template: string } => {
  const space = key.indexOf(" ");
  return { method: key.slice(0, space), template: key.slice(space + 1) };
};

const fillPath = (template: string, params: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    // A missing path parameter is a bug here, not a request to make. v1 sent
    // `""` into a uuid column, which threw in Postgres, got swallowed, and
    // rendered a blank chart.
    if (value === undefined) throw new Error(`missing path parameter ${name} for ${template}`);
    return encodeURIComponent(value);
  });

export type ClientOptions = {
  readonly baseUrl: string;
  /** Sent on every request. Used by the server variant to forward a cookie. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Browser only. Makes the session cookie travel cross-origin. */
  readonly credentials?: RequestCredentials;
  readonly fetch?: typeof fetch;
};

export type ApiClient = {
  <T = unknown>(operationId: string, options?: RequestOptions): Promise<ApiResponse<T>>;
};

/** Reverse index, built once: the client is addressed by operation name. */
const BY_OPERATION_ID: ReadonlyMap<string, { key: string; spec: OperationSpec }> = new Map(
  Object.entries(OPERATIONS).map(([key, spec]) => [spec.operationId, { key, spec }]),
);

export const createClient = (options: ClientOptions): ApiClient => {
  const http = options.fetch ?? fetch;

  return async <T,>(operationId: string, request: RequestOptions = {}): Promise<ApiResponse<T>> => {
    const entry = BY_OPERATION_ID.get(operationId);
    // Only names the contract knows. A typo is a throw here rather than a 404
    // from the API that reads like the resource is missing.
    if (entry === undefined) throw new Error(`unknown operation ${operationId}`);

    const { method, template } = splitKey(entry.key);
    const params = request.params ?? {};
    const url = new URL(fillPath(template, params), options.baseUrl);
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }

    const headers: Record<string, string> = { accept: "application/json", ...options.headers };
    if (request.body !== undefined) headers["content-type"] = "application/json";
    if (request.ifMatch !== undefined) headers["if-match"] = request.ifMatch;
    if (request.bearer !== undefined) headers["authorization"] = `Bearer ${request.bearer}`;

    const response = await http(url, {
      method,
      headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      // A call carrying its own bearer is not the session's: sending the
      // cookie too would attach ambient authority the caller did not ask for,
      // and the API would then require an Origin it has no reason to.
      ...(options.credentials === undefined || request.bearer !== undefined
        ? {}
        : { credentials: options.credentials }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      // A signed-in response must never be served from a shared cache.
      cache: "no-store",
    });

    const requestId = response.headers.get("counted-request-id");

    if (!response.ok) {
      // The API speaks `application/problem+json`. Anything else is a proxy
      // answering on its behalf, and pretending it parsed would report a
      // misleading reason.
      const isProblem = (response.headers.get("content-type") ?? "").includes("problem+json");
      const problem = isProblem ? ((await response.json().catch(() => null)) as Record<string, unknown> | null) : null;
      throw new ApiError(response.status, problem, requestId);
    }

    // Parse a body when the server says it sent one, rather than when the
    // status happens to be a value we remembered.
    //
    // This special-cased 204 only, so any *other* bodyless success threw a
    // SyntaxError from `response.json()` on empty input. `POST
    // /v1/auth/sign-in` answers `202` with no body, so every successful
    // sign-in request raised — and the sign-in page's `catch` reported it as
    // "That does not look like an email address." The link had already been
    // sent each time; the only broken thing was the reading of the reply.
    const contentType = response.headers.get("content-type") ?? "";
    const hasBody =
      response.status !== 204 && response.status !== 205 && contentType.includes("json");
    const data = hasBody ? ((await response.json()) as T) : (undefined as T);

    return {
      data,
      etag: response.headers.get("etag"),
      requestId,
      // Derived from the contract, not from a key map in the UI. A third list
      // describing the same set is a third thing to go stale.
      provides: (entry.spec.provides ?? []).map((tag) => resolveTag(tag, params)),
      invalidates: (entry.spec.invalidates ?? []).map((tag) => resolveTag(tag, params)),
    };
  };
};

/**
 * The browser client.
 *
 * `credentials: "include"` is what makes the session cookie travel to the API
 * origin. Without it the browser sends nothing and every call is anonymous —
 * which fails as a 401 rather than as an error anyone would recognise.
 */
export const browserApi = (): ApiClient =>
  createClient({
    baseUrl: publicApiUrl(),
    credentials: "include",
  });

/**
 * The server client, for RSC and route handlers.
 *
 * The cookie is forwarded verbatim rather than re-derived: this app never
 * inspects the session, and could not — it is opaque and `HttpOnly`.
 */
export const serverApi = (cookieHeader: string | null, traceparent?: string): ApiClient =>
  createClient({
    baseUrl: serverApiUrl(),
    headers: {
      ...(cookieHeader === null ? {} : { cookie: cookieHeader }),
      ...(traceparent === undefined ? {} : { traceparent }),
    },
  });

/**
 * Where the API is, from each side.
 *
 * Two variables because the two sides genuinely differ: a browser must use the
 * public hostname, while a server component inside the same private network
 * may reach it directly. They default to the same thing so that a development
 * setup needs neither.
 */
export const publicApiUrl = (): string =>
  process.env["NEXT_PUBLIC_COUNTED_API_URL"] ?? "http://localhost:8080";

export const serverApiUrl = (): string =>
  process.env["COUNTED_API_URL"] ?? publicApiUrl();
