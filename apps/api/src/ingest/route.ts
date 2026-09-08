/**
 * `POST /v1/events` — the hot path, hand-written and deliberately outside oRPC.
 *
 * Its schemas are in @counted/contract and its transport stays here. Its
 * behaviour is a group commit: many requests coalesce into one write, and each
 * one is acknowledged *after* that write is durable. There is no RPC layer that
 * makes that easier to express, and four SDKs already implement its wire format
 * — `{ events: [...] }` in, `{ accepted, deduplicated, rejected }` out.
 *
 * **The contract in one line: a 2xx means the events are durable.** v1's ingest
 * returned 202 with an empty body whether it had written the batch or dropped
 * it past a quota — byte-identical responses for "stored" and "discarded" — and
 * the SDK moved on either way. Every branch here ends in a status the SDK can
 * act on, and `@counted/ingestion-app` guarantees the acknowledgement comes
 * after the commit.
 *
 * **Two ways to present a key, and both are real.** `Authorization: Bearer` is
 * what the SDK sends normally; `?key=` is what it sends through
 * `navigator.sendBeacon` on page unload, which cannot set headers. Refusing the
 * second would lose the last events of every session.
 *
 * **The workspace and project come from the credential, never from the body.**
 * A body that could name its own project is a body that can write into somebody
 * else's.
 *
 * **The country comes from the connection, and the address does not outlive
 * this function.** `clientAddress` reads one `X-Forwarded-For` entry,
 * `GeoLocator` turns it into two letters, and the string is unreachable after
 * that: it is never put on the batch, never logged, never hashed. The same rule
 * as above, for the same reason — a body that could name its own country is a
 * body that can put its events anywhere on the map.
 */

import { Duration, type Instant, type ProjectId, type WorkspaceId } from "@counted/kernel";
import type { CredentialStore } from "@counted/identity-ports";
import type { GroupCommit } from "@counted/ingestion-app";
import type { CountryCode, IngestBatch, RawEvent } from "@counted/ingestion-domain";
import type { GeoLocator } from "@counted/ingestion-ports";
import type { IngestFailure, IngestReceipt } from "@counted/contract";
import { fromBatchAdmissionError, type Fault } from "../faults";
import { clientAddress } from "./client-ip";
import type { Logger } from "../logging";

/**
 * The workspace an unclaimed project's events are billed to.
 *
 * A sentinel, and the only one in the system. `IngestBatch.workspace` is not
 * nullable and an unclaimed project has no workspace — the quota recogniseses
 * this value and charges nobody. The tilde makes it un-mintable by better-auth,
 * which produces UUIDs, so it cannot collide with a real workspace id.
 */
export const UNOWNED_WORKSPACE = "~unclaimed" as WorkspaceId;

export type IngestDeps = {
  readonly credentials: CredentialStore;
  readonly commit: GroupCommit;
  /** The workspace a project belongs to; `null` while unclaimed. */
  projectWorkspace(project: ProjectId): Promise<WorkspaceId | null | undefined>;
  readonly logger: Logger;
  readonly maxBodyBytes: number;
  /**
   * Turns the request address into a country. Local, synchronous, no network.
   *
   * Not optional. An absent locator would mean every event lands with no
   * geography and nothing anywhere says so — a country breakdown that is empty
   * forever and reads as "nobody outside the office uses this". A deployment
   * that genuinely cannot place its callers says so with
   * `trustedProxyHops: 0`, which is a decision somebody made rather than a
   * field somebody forgot.
   */
  readonly geo: GeoLocator;
  /**
   * How many proxies append to `X-Forwarded-For` in front of this server.
   * `0` disables geography. See `client-ip.ts` for why it is counted from the
   * right and why the number cannot be inferred.
   */
  readonly trustedProxyHops: number;
};

export type IngestOutcome = {
  readonly status: number;
  readonly body: IngestReceipt | IngestFailure;
  readonly headers: Readonly<Record<string, string>>;
};

const problem = (fault: Fault, retryable: boolean, retryAfterMs?: number): IngestOutcome => ({
  // 402 and 429 are not the same instruction — upgrade versus back off — and
  // the SDK branches on `retryable` before it branches on the status, so the
  // flag is what actually decides whether a batch is resent.
  status: STATUS[fault.code] ?? 500,
  body: { code: fault.code, detail: fault.message, retryable, ...fault.data },
  headers:
    retryAfterMs === undefined
      ? {}
      : { "retry-after": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
});

const STATUS: Readonly<Record<string, number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
  SERVICE_UNAVAILABLE: 503,
};

const unauthorized: IngestOutcome = {
  status: 401,
  body: { code: "UNAUTHORIZED", detail: "No usable credential was presented.", retryable: false },
  headers: {},
};

/** The key, from the header the SDK normally sends or the query a beacon must. */
export const ingestKeyOf = (request: Request): string | null => {
  const header = request.headers.get("authorization");
  if (header !== null) {
    const matched = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (matched?.[1] !== undefined) return matched[1].trim();
  }
  const query = new URL(request.url).searchParams.get("key");
  return query !== null && query.length > 0 ? query : null;
};

/**
 * The country of one address, and never a reason to lose the batch.
 *
 * The bundled locator is a binary search over a decoded table and has no
 * failure mode, so this catch is for whatever is wired in next. The rule it
 * encodes is the same one `normaliseSystemProperties` follows: a broken
 * dimension costs the event its dimension, not its existence. Losing 250 events
 * because a lookup table was mid-reload would be trading data for a slice.
 *
 * **The address is redacted out of the failure message before it is logged.**
 * The error path is where the discard is easiest to break: a locator's own
 * exception routinely quotes the input that broke it, and nothing about a
 * third-party message is under our control. Substituting the one string we know
 * must not appear keeps the diagnostic and keeps the promise, which is better
 * than either logging blind or logging nothing.
 */
const locate = (deps: IngestDeps, address: string): CountryCode | null => {
  try {
    return deps.geo.countryOf(address);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    deps.logger.warn("country lookup failed; the batch is unaffected", {
      detail: detail.split(address).join("<address>"),
    });
    return null;
  }
};

export const handleIngest = async (
  deps: IngestDeps,
  request: Request,
  at: Instant,
): Promise<IngestOutcome> => {
  const secret = ingestKeyOf(request);
  if (secret === null) return unauthorized;

  const verified = await deps.credentials.verify(secret, at);
  if (!verified.ok) {
    if (verified.error.kind === "RateLimited") {
      return problem(
        {
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests.",
          data: { reason: "RateLimited" },
        },
        true,
        Duration.toMillis(verified.error.retryAfter),
      );
    }
    // Unknown, revoked and expired are one answer. Anything else tells whoever
    // is guessing which of their guesses exists.
    return unauthorized;
  }

  const credential = verified.value;
  if (credential.project === null || !credential.permissions.includes("events:write")) {
    // A service key with no project, or one that cannot write events. Refused
    // as 403 rather than 401: the credential is real and the caller should stop
    // retrying with it rather than go and get a new one.
    return {
      status: 403,
      body: {
        code: "FORBIDDEN",
        detail: "This credential cannot write events.",
        retryable: false,
        reason: "NotPermitted",
        required: "events:write",
      },
      headers: {},
    };
  }

  const raw = await request.text();
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (bytes > deps.maxBodyBytes) {
    // Measured at the socket rather than after parsing: re-serialising the
    // parsed body would measure our serialiser, not what the client sent.
    return problem(
      fromBatchAdmissionError({
        kind: "PayloadTooLarge",
        bytes,
        max: deps.maxBodyBytes,
      }),
      false,
    );
  }

  let events: readonly RawEvent[];
  try {
    const body = JSON.parse(raw) as { events?: unknown };
    if (!Array.isArray(body?.events)) {
      return {
        status: 400,
        body: { code: "BAD_REQUEST", detail: "`events` must be an array.", retryable: false },
        headers: {},
      };
    }
    events = body.events as readonly RawEvent[];
  } catch {
    return {
      status: 400,
      body: { code: "BAD_REQUEST", detail: "The body is not JSON.", retryable: false },
      headers: {},
    };
  }

  const workspace = await deps.projectWorkspace(credential.project);
  if (workspace === undefined) {
    // The key names a project that no longer exists. Nothing to write into and
    // nothing a retry will fix.
    return {
      status: 404,
      body: { code: "NOT_FOUND", detail: "No such project.", retryable: false },
      headers: {},
    };
  }

  // The address exists for exactly these three lines. `country` is two letters
  // or null; `address` is out of scope before the batch is built.
  const address = clientAddress(request.headers, deps.trustedProxyHops);
  const country: CountryCode | null = address === null ? null : locate(deps, address);

  const batch: IngestBatch = {
    workspace: workspace ?? UNOWNED_WORKSPACE,
    project: credential.project,
    receivedAt: at,
    events,
    country,
    bytes,
  };

  const ack = await deps.commit.submit(batch);

  if (ack.kind === "Refused") {
    const fault = fromBatchAdmissionError(ack.error);
    const retryable = ack.error.kind === "RateLimited" || ack.error.kind === "SinkUnavailable";
    return problem(
      fault,
      retryable,
      ack.error.kind === "RateLimited" ? ack.error.retryAfterMs : undefined,
    );
  }

  // Per-event rejections travel in the body of a 2xx, because the rest of the
  // batch did land and a status cannot say "eleven of twelve". `outcomes` is
  // what the SDK reads to stop resending the three it got wrong.
  return {
    status: 202,
    body: {
      accepted: ack.accepted,
      deduplicated: ack.deduplicated,
      rejected: ack.rejected.length,
      ...(ack.rejected.length === 0
        ? {}
        : {
            outcomes: ack.rejected.map((rejection) => ({
              index: rejection.index,
              accepted: false,
              reason: rejection.error.kind,
            })),
          }),
    },
    headers: {},
  };
};
