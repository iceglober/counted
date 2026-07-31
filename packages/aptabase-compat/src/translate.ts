/**
 * Aptabase's wire shape, translated at the boundary.
 *
 * An anti-corruption layer in the strict sense: **nothing in this file's
 * vocabulary exists anywhere else in the system.** `eventName`, `sessionId`,
 * `systemProps`, `isDebug`, `A-US-` — all of them stop here. What leaves is
 * the v1 ingest contract, and the domain never learns that Aptabase was
 * involved.
 *
 * That is the whole point of keeping it a separate package. v1 had Aptabase's
 * field names in its database columns, so a rename in their SDK would have
 * been a migration in ours.
 *
 * Pure and total. Given any JSON it returns either events or a reason, never
 * throws, and touches no clock and no network — so every mapping decision is
 * testable without a server.
 */

/** What Aptabase sends. Named exactly as they name it, and only here. */
export type AptabaseEvent = {
  readonly timestamp?: unknown;
  readonly sessionId?: unknown;
  readonly eventName?: unknown;
  readonly systemProps?: unknown;
  readonly props?: unknown;
};

/** What we speak. Structurally the contract's `IngestEvent`, by hand. */
export type IngestEvent = {
  readonly name: string;
  readonly visitId: string;
  readonly occurredAt?: string;
  readonly properties?: Record<string, string | number | boolean | null>;
  readonly systemProperties?: Record<string, string | null>;
};

export type Translation =
  | { readonly ok: true; readonly events: readonly IngestEvent[] }
  | { readonly ok: false; readonly reason: string };

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * Their system properties, mapped onto ours.
 *
 * The names differ because ours are snake_case on the wire and theirs are
 * camelCase; the *meanings* line up one-for-one, which is why this is a rename
 * rather than a reinterpretation.
 */
const SYSTEM_FIELDS: readonly (readonly [aptabase: string, counted: string])[] = [
  ["osName", "os_name"],
  ["osVersion", "os_version"],
  ["locale", "locale"],
  ["appVersion", "app_version"],
  ["deviceModel", "device_model"],
  ["sdkVersion", "sdk_version"],
];

/**
 * Fields Aptabase carries that Counted has no column for.
 *
 * They become ordinary event properties rather than being dropped. Silently
 * discarding data somebody is already sending is the worse failure: they would
 * see the event arrive and the field simply not be there, with nothing to
 * explain it.
 */
const AS_PROPERTIES: readonly (readonly [aptabase: string, property: string])[] = [
  ["isDebug", "aptabase_is_debug"],
  ["appBuildNumber", "aptabase_app_build_number"],
];

const MAX_BATCH = 250;

const translateOne = (raw: unknown, index: number): { ok: true; event: IngestEvent } | { ok: false; reason: string } => {
  const event = asObject(raw);
  if (event === null) return { ok: false, reason: `events[${index}]: not an object` };

  const name = asString(event["eventName"]);
  if (name === null) return { ok: false, reason: `events[${index}]: eventName is required` };

  // Their session id becomes our visit id. This is the one mapping worth
  // stating plainly: both are ephemeral activity groupings, neither is an
  // identity, and Counted will not treat it as one. v1's schema called the
  // same value `session_id` and then counted distinct values of it as "users".
  const sessionId = asString(event["sessionId"]);
  if (sessionId === null) return { ok: false, reason: `events[${index}]: sessionId is required` };

  const system = asObject(event["systemProps"]) ?? {};
  const systemProperties: Record<string, string | null> = {};
  for (const [theirs, ours] of SYSTEM_FIELDS) {
    const value = system[theirs];
    // `null` is meaningful — "the SDK looked and there was nothing" — and is
    // kept. Absent stays absent.
    if (value === null) systemProperties[ours] = null;
    else if (typeof value === "string") systemProperties[ours] = value;
  }

  const properties: Record<string, string | number | boolean | null> = {};
  const theirProps = asObject(event["props"]);
  if (theirProps !== null) {
    for (const [key, value] of Object.entries(theirProps)) {
      if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        properties[key] = value;
      }
      // Anything else — a nested object, an array — is dropped rather than
      // stringified. A property that arrives as "[object Object]" is worse
      // than one that is missing, because it looks like a value.
    }
  }
  for (const [theirs, ours] of AS_PROPERTIES) {
    const value = system[theirs];
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      properties[ours] = value;
    }
  }

  const translated: IngestEvent = {
    name,
    visitId: sessionId,
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(Object.keys(systemProperties).length > 0 ? { systemProperties } : {}),
  };

  // Their timestamp is an ISO string or epoch millis. Ours is an instant, and
  // an unparseable one is left absent so the server stamps arrival — which is
  // warned about downstream rather than silently treated as equivalent.
  const timestamp = event["timestamp"];
  if (typeof timestamp === "string" || typeof timestamp === "number") {
    const parsed = new Date(timestamp).getTime();
    if (Number.isFinite(parsed)) return { ok: true, event: { ...translated, occurredAt: new Date(parsed).toISOString() } };
  }

  return { ok: true, event: translated };
};

/**
 * Translate one request body.
 *
 * `/api/v0/event` sends an object, `/api/v0/events` sends an array, and both
 * are accepted on both paths — their own SDKs are not consistent about it, and
 * refusing would break a client that works against Aptabase itself.
 */
export const translate = (body: unknown): Translation => {
  const batch = Array.isArray(body) ? body : [body];
  if (batch.length === 0) return { ok: false, reason: "empty batch" };
  if (batch.length > MAX_BATCH) return { ok: false, reason: `batch exceeds ${MAX_BATCH} events` };

  const events: IngestEvent[] = [];
  for (const [index, raw] of batch.entries()) {
    const one = translateOne(raw, index);
    // The whole batch, or none of it. Their SDK retries the batch it sent, so
    // partially accepting one would double-count everything that succeeded.
    if (!one.ok) return { ok: false, reason: one.reason };
    events.push(one.event);
  }
  return { ok: true, events };
};
