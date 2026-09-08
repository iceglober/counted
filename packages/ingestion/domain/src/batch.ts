/**
 * `IngestBatch` is a command, not an aggregate.
 *
 * Nothing stores it, nothing loads it, it has no identity and no history. It
 * is one HTTP request's worth of intent — these events, from this project, as
 * they arrived — handed to `admit` and then discarded. v1 modelled ingest as a
 * repository write per event and paid for it twice: a round trip per event on
 * the hot path, and a "batch" entity in the schema that nothing ever read.
 *
 * The raw shapes here are deliberately `unknown`-typed. This is the outermost
 * edge of the system: the body is JSON somebody else wrote, four SDKs and a
 * compatibility shim all produce it, and treating it as already-typed is how
 * `properties: "null"` reaches a jsonb column.
 */

import type { Instant, ProjectId, WorkspaceId } from "@counted/kernel";

import type { CountryCode } from "./country";

/** A property value as it may legitimately appear on the wire. */
export type PropertyValue = string | number | boolean | null;

/**
 * One event as the SDK sends it. Every field `unknown` because every field
 * arrives from JSON.
 *
 * `occurredAt` and `idempotencyKey` are optional on the wire and always
 * present from a Counted SDK. The Aptabase compatibility shim has neither to
 * give, which is why absence is handled rather than refused — see `admit`.
 */
export type RawEvent = {
  readonly name?: unknown;
  readonly visitId?: unknown;
  /** Set only by an explicit `identify()`. Never derived from anything. */
  readonly userId?: unknown;
  readonly occurredAt?: unknown;
  readonly idempotencyKey?: unknown;
  readonly properties?: unknown;
  readonly systemProperties?: unknown;
};

export type IngestBatch = {
  /** Both ids come from the verified credential, never from the body. */
  readonly workspace: WorkspaceId;
  readonly project: ProjectId;
  /**
   * When the request reached us. Used to stamp events with no `occurredAt`,
   * and as the reference point for clock skew — not `Date.now()`, because the
   * domain has no clock and because every event in one batch must be judged
   * against one instant or the boundary cases are nondeterministic.
   */
  readonly receivedAt: Instant;
  readonly events: readonly RawEvent[];
  /**
   * The country the request came from, worked out at the edge and stamped on
   * every event in the batch.
   *
   * On the batch rather than on an event because it is a property of the
   * connection, not of anything the client said — one request comes from one
   * place. `null` when the address could not be read or is not delegated to a
   * country.
   *
   * **The address itself is not here, and that is the design.** The domain has
   * no field that could hold one, so there is nothing to accidentally log,
   * store, or hash into an identifier. The transport resolves the country and
   * lets the address go; see `country.ts`.
   *
   * Not optional. A caller that omitted it would produce events with no
   * geography, no error, and a country breakdown that reads empty forever —
   * which is exactly the class of silent failure this package exists to make
   * impossible.
   */
  readonly country: CountryCode | null;
  /**
   * The body size the transport measured, or `null` when it could not.
   *
   * Measured at the socket rather than recomputed here: re-serialising the
   * parsed body to count its bytes measures our serialiser, not what the
   * client sent, and a body that was already too large has by then been read
   * into memory anyway.
   */
  readonly bytes: number | null;
};
