/**
 * `route()` — the only way a procedure in this package gets an HTTP shape.
 *
 * It exists so three things cannot drift apart: the URL, the authorization
 * requirement, and the query-parameter decoding. Each is stated once, in one
 * object, and everything downstream is computed.
 *
 * Two facts about `@orpc/*@2.0.0-beta.32`, both verified by generating a
 * document rather than remembered:
 *
 *   - `oc` has five methods — meta, errors, input, output, router. There is no
 *     `.route()`, `.prefix()` or `.tag()`; routing metadata is an
 *     `openapi()` meta plugin.
 *   - `spec` receives the generated operation object and returns a replacement,
 *     which is the only hook that can attach a `security` block. oRPC derives
 *     security from nothing — it does not read middleware and cannot.
 */

import { openapi } from "@orpc/openapi";
import {
  declareRequirement,
  securityFor,
  type AuthorizationRequirement,
} from "./authorization";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * How one query parameter is spelled on the wire.
 *
 * oRPC's default for a query parameter is bracket notation (`?a[]=1&a[]=2`),
 * which is not OpenAPI-native: Scalar and Swagger UI generate `?a=1&a=2` from
 * the document and oRPC's own server then decodes it as something else. Every
 * query parameter in this contract names its style, and a test asserts the set
 * of named styles equals the set of query parameters the generator emitted.
 */
export type QueryStyle =
  | "primitive"
  | "array"
  | "comma-delimited-array"
  | "comma-delimited-object"
  | "json";

export type RouteSpec = {
  /**
   * Operation id, and by convention the procedure's dotted path in the contract
   * tree. A test asserts the convention holds, which is what lets the
   * authorization registry be keyed by it.
   */
  readonly id: string;
  readonly method: HttpMethod;
  /** `{braces}`, never `:colons`. Every param must be a required input field. */
  readonly path: `/${string}`;
  readonly summary: string;
  readonly description?: string;
  readonly tags: readonly [string, ...string[]];
  readonly authorize: AuthorizationRequirement;
  /** Every query parameter this route takes, and how it is spelled. */
  readonly query?: Readonly<Record<string, QueryStyle>>;
  readonly successStatus?: number;
};

/**
 * Builds the meta plugin for one route and records its authorization
 * requirement.
 *
 * The registration is a side effect of declaring the route, on purpose: there
 * is no way to describe a procedure in this package without also saying who may
 * call it.
 */
export const route = (spec: RouteSpec): ReturnType<typeof openapi> => {
  declareRequirement(spec.id, spec.authorize);

  const security = securityFor(spec.authorize);

  return openapi({
    method: spec.method,
    path: spec.path,
    operationId: spec.id,
    summary: spec.summary,
    tags: [...spec.tags],
    ...(spec.description === undefined ? {} : { description: spec.description }),
    ...(spec.successStatus === undefined ? {} : { successStatus: spec.successStatus }),
    ...(spec.query === undefined ? {} : { queryStyles: { ...spec.query } }),
    spec: (current) => ({
      ...current,
      security: security.map((requirement) => ({ ...requirement })),
      // The requirement itself, in the artifact. A client generator, the MCP
      // projection and a human reading the JSON all get the same fact the
      // server enforces, instead of inferring it from the scheme list.
      "x-counted-authorization": spec.authorize,
    }),
  });
};
