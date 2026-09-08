/**
 * What every procedure is handed, and what it is handed after the decision.
 *
 * `ApiContext` is built per request by the transport and carries only facts
 * about the request itself. `AuthorizedContext` is what the authorization
 * middleware produces; a handler cannot be written against the first, so
 * "somebody forgot to authorize this route" is a type error rather than an
 * omission somebody has to notice in review.
 */

import type { Instant } from "@counted/kernel";
import type { Authority } from "./auth/authorize";
import type { Logger } from "./logging";

export type ApiContext = {
  readonly request: Request;
  /** Read once per request and shared by everything in it. */
  readonly at: Instant;
  readonly traceId: string;
  readonly logger: Logger;
};

export type AuthorizedContext = ApiContext & {
  readonly authority: Authority;
};
