/**
 * Answering the way Aptabase answers.
 *
 * Their SDKs branch on the status code and read nothing else, so the shape
 * that matters is the status. Deliberately *not* our `application/problem+json`
 * envelope: a client written against Aptabase would not understand it, and
 * sending it would be asserting a contract this endpoint does not have.
 *
 * This is the second half of an anti-corruption layer, and the half that
 * usually gets forgotten. Translating the request in and then answering in our
 * own vocabulary leaves the caller with a response it cannot parse.
 */

export type CompatResponse = { readonly status: number; readonly body: string | null; readonly headers: Record<string, string> };

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Accepted.
 *
 * Aptabase answers `200` with an empty body. Counted's own ingest answers
 * `202` with a receipt, because it waits for the commit — but a client written
 * against Aptabase treats anything 2xx as done and never reads the body, so
 * the receipt would be discarded. `200` is what their clients expect.
 */
export const accepted = (): CompatResponse => ({ status: 200, body: null, headers: {} });

export const badRequest = (reason: string): CompatResponse => ({
  status: 400,
  body: JSON.stringify({ error: reason }),
  headers: JSON_HEADERS,
});

export const unauthorized = (detail: string): CompatResponse => ({
  status: 401,
  body: JSON.stringify({ error: detail }),
  headers: JSON_HEADERS,
});

export const tooLarge = (): CompatResponse => ({
  status: 413,
  body: JSON.stringify({ error: "Payload too large" }),
  headers: JSON_HEADERS,
});

export const rateLimited = (retryAfterSeconds: number): CompatResponse => ({
  status: 429,
  body: JSON.stringify({ error: "Too many requests" }),
  headers: { ...JSON_HEADERS, "retry-after": String(retryAfterSeconds) },
});

/**
 * Everything else under `/api/v0/`.
 *
 * `410 Gone`, not `404`: these endpoints existed, and saying so is the
 * difference between "you have the wrong URL" and "this was removed, here is
 * what replaced it". The `Link` header names the successor in a form a client
 * can follow without reading prose.
 */
export const gone = (path: string): CompatResponse => ({
  status: 410,
  body: JSON.stringify({
    error: `${path} was removed in the v1 API.`,
    successor: "/v1/openapi.json",
  }),
  headers: {
    ...JSON_HEADERS,
    link: '</v1/openapi.json>; rel="successor-version"',
  },
});
