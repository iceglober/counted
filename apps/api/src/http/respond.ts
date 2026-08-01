/**
 * Sending a problem.
 *
 * The single place a failure becomes a response. Every path — a guard denial,
 * a validation failure, an unhandled throw, a 404 for an unknown route — ends
 * here, which is what makes the invariants below hold everywhere instead of
 * wherever someone remembered.
 *
 * Three of them are structural:
 *   - `content-type: application/problem+json`, never plain json
 *   - `WWW-Authenticate` on every 401, without exception
 *   - `Retry-After` whenever the body carries `retryAfter`
 *
 * v1 emitted the discovery header the product documents from exactly one
 * route, and returned eight different envelope shapes from the rest.
 */

import type { Context } from "hono";
import { problemFor, type ErrorCode, type ProblemOptions } from "@counted/contracts";
import type { ApiEnv } from "../server";

export type ProblemContext = ProblemOptions & {
  /** The scope the caller lacked, for the `WWW-Authenticate` challenge. */
  readonly scope?: string;
};

export const sendProblem = (c: Context<ApiEnv>, code: ErrorCode, context: ProblemContext = {}): Response => {
  const body = problemFor(code, c.get("requestId"), {
    ...context,
    // The path that failed, always. It costs nothing and it is the first
    // thing anyone reading a support ticket wants.
    instance: context.instance ?? c.req.path,
  });

  const headers: Record<string, string> = {
    "content-type": "application/problem+json",
  };

  if (body.status === 401) {
    // RFC 9728. Emitted here rather than by a route, so it cannot be omitted:
    // there is no other way to produce a 401.
    const challenge = [
      'Bearer realm="counted"',
      ...(context.scope === undefined ? [] : [`scope="${context.scope}"`]),
      // On the API host, not the marketing host. RFC 9728 puts protected-
      // resource metadata on the resource server — the origin actually serving
      // the API. This named counted.dev, which does not serve it; and for a
      // long time nothing served it anywhere, so every 401 handed the caller a
      // URL that 404s.
      'resource_metadata="https://api.counted.dev/.well-known/oauth-protected-resource"',
      'error="invalid_token"',
    ];
    headers["www-authenticate"] = challenge.join(", ");
  }

  if (body.retryAfter !== undefined) headers["retry-after"] = String(body.retryAfter);

  return c.json(body, body.status as 400, headers);
};
