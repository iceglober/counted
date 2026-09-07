/**
 * Admission: the one place untrusted JSON becomes an event this system will
 * store.
 *
 * Everything past this function is typed, bounded and canonical. Everything
 * before it is a string somebody else wrote. v1 had no such line — the route
 * handler validated some fields, the repository coerced others, and the parts
 * nobody checked (`os_name`, `properties`) went to the database as they
 * arrived, which is how one operating system became four dictionary values.
 *
 * Two shapes of failure, kept apart because the HTTP answers differ:
 *
 *   **the batch is refused** — too many events, body too large. Nothing lands,
 *   and the client is told once. `Err`.
 *   **an event is refused** — a bad name, a broken person id, a clock a month
 *   out. The rest of the batch still lands and the receipt names what did not.
 *   `Ok` with a populated `rejected`.
 *
 * The second is the one worth defending. All-or-nothing on a fifty-event batch
 * means one typo in one property costs forty-nine good events, and the client
 * cannot resend the good ones because it does not know which they were.
 */

import { Duration, Instant, VisitId, isVisitId } from "@counted/kernel";
import type { PersonId, Result } from "@counted/kernel";
import { err, ok } from "@counted/kernel";

import type { IngestBatch, PropertyValue, RawEvent } from "./batch";
import { collapseDuplicates, dedupKey, type DedupKey } from "./dedup";
import type { BatchAdmissionError, EventAdmissionError, RejectedEvent } from "./errors";
import { checkAgentVocabulary, checkEventName } from "./event-name";
import { admitOptionalPerson } from "./person";
import { normaliseSystemProperties, type SystemProperties } from "./system-properties";

/**
 * An event that has passed every rule. This is the shape handed to the
 * `EventSink`, and the only shape it accepts.
 *
 * `visit` and `person` are separate branded fields and neither is derivable
 * from the other. That is the whole privacy claim in one type: a `PersonId`
 * exists only because a customer called `identify()`, so "unique users" cannot
 * quietly become a count of half-hour sessions the way it did in v1.
 */
export type AdmittedEvent = {
  readonly name: string;
  readonly visit: VisitId;
  readonly person: PersonId | null;
  /** When the client says it happened. Never re-stamped — see `dedup.ts`. */
  readonly occurredAt: Instant;
  /** When we heard about it. Kept so a buffered batch's delay is measurable. */
  readonly receivedAt: Instant;
  /** `null` when the client sent no idempotency key: at-least-once, no collapse. */
  readonly dedupKey: DedupKey | null;
  readonly properties: Readonly<Record<string, PropertyValue>>;
  readonly system: SystemProperties;
};

export type AdmissionPolicy = {
  readonly maxEventsPerBatch: number;
  readonly maxBodyBytes: number;
  readonly maxProperties: number;
  readonly maxPropertyKeyLength: number;
  readonly maxPropertyValueLength: number;
  /**
   * How far ahead of `receivedAt` an event may claim to have happened.
   *
   * Rejected rather than clamped. Clamping moves somebody's data to a time it
   * did not happen and says nothing; rejecting names a broken device clock,
   * which is a thing the developer can go and fix.
   */
  readonly maxFutureSkew: Duration;
  /**
   * How far behind. Generous, because an SDK that buffered through a week
   * offline is behaving exactly as designed and its events are still true.
   */
  readonly maxAge: Duration;
};

export const DEFAULT_ADMISSION_POLICY: AdmissionPolicy = {
  // The JS SDK caps its own batches at 250 (`client.ts`); the server bound is
  // the same number so a conforming client is never surprised by it.
  maxEventsPerBatch: 250,
  // `contract/gen/contract.json` → defaults.maxBodyBytes.
  maxBodyBytes: 1_048_576,
  maxProperties: 64,
  maxPropertyKeyLength: 64,
  maxPropertyValueLength: 1_024,
  maxFutureSkew: Duration.minutes(5),
  maxAge: Duration.days(30),
};

export type AdmissionOutcome = {
  readonly admitted: readonly AdmittedEvent[];
  readonly rejected: readonly RejectedEvent[];
  /** Repeats collapsed inside this batch. The sink collapses across batches. */
  readonly duplicates: number;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const malformed = (index: number, detail: string): EventAdmissionError => ({
  kind: "MalformedEvent",
  index,
  detail,
});

/**
 * Parse the client's timestamp.
 *
 * ISO-8601 is what every Counted SDK sends. Epoch milliseconds are accepted
 * too because the Aptabase compatibility shim and hand-rolled `curl` clients
 * send them, and refusing a number that is unambiguously a timestamp helps
 * nobody. Absent means "stamp it on arrival", which the Aptabase shim relies
 * on when a translated timestamp was unparseable.
 */
const parseOccurredAt = (raw: unknown, receivedAt: Instant, index: number): Result<Instant, EventAdmissionError> => {
  if (raw === undefined || raw === null) return ok(receivedAt);

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? ok(Instant.fromEpochMillis(raw)) : err(malformed(index, "occurredAt is not a timestamp"));
  }
  if (typeof raw !== "string") return err(malformed(index, "occurredAt must be an ISO-8601 string or epoch millis"));

  const parsed = Instant.fromISO(raw);
  return parsed.ok ? parsed : err(malformed(index, `occurredAt is not a timestamp: ${raw}`));
};

const checkSkew = (
  occurredAt: Instant,
  receivedAt: Instant,
  policy: AdmissionPolicy,
): EventAdmissionError | null => {
  // Signed: positive means the client's clock is ahead of ours.
  const skewMs = Duration.toMillis(Instant.between(receivedAt, occurredAt));

  const futureMax = Duration.toMillis(policy.maxFutureSkew);
  if (skewMs > futureMax) return { kind: "ClockSkew", skewMs, max: futureMax };

  const ageMax = Duration.toMillis(policy.maxAge);
  if (-skewMs > ageMax) return { kind: "ClockSkew", skewMs, max: ageMax };

  return null;
};

/**
 * Properties, checked rather than coerced.
 *
 * A nested object or an array is refused, not stringified and not dropped.
 * Stringifying produces `"[object Object]"`, which looks like a value and is
 * not; dropping loses a field the developer believes they are sending. Both
 * are silent, and silence at the edge of the system is how v1's data got the
 * way it was. The refusal names the property, so the fix is one line.
 */
const admitProperties = (
  raw: unknown,
  index: number,
  policy: AdmissionPolicy,
): Result<Readonly<Record<string, PropertyValue>>, EventAdmissionError> => {
  if (raw === undefined || raw === null) return ok({});
  if (!isPlainObject(raw)) return err(malformed(index, "properties must be an object"));

  const entries = Object.entries(raw);
  if (entries.length > policy.maxProperties) {
    return err(malformed(index, `at most ${policy.maxProperties} properties, got ${entries.length}`));
  }

  const properties: Record<string, PropertyValue> = {};
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > policy.maxPropertyKeyLength) {
      return err(malformed(index, `property names must be 1-${policy.maxPropertyKeyLength} characters`));
    }
    if (value === null || typeof value === "boolean") {
      properties[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return err(malformed(index, `${key} is not a finite number`));
      properties[key] = value;
      continue;
    }
    if (typeof value === "string") {
      if (value.length > policy.maxPropertyValueLength) {
        return err(malformed(index, `${key} must be at most ${policy.maxPropertyValueLength} characters`));
      }
      properties[key] = value;
      continue;
    }
    return err(malformed(index, `${key} must be a string, number, boolean or null`));
  }

  return ok(properties);
};

/** One event, all the way through. Exported for tests and for nothing else to call directly. */
export const admitEvent = (
  raw: RawEvent,
  index: number,
  batch: IngestBatch,
  policy: AdmissionPolicy,
): Result<AdmittedEvent, EventAdmissionError> => {
  if (!isPlainObject(raw)) return err(malformed(index, "event must be an object"));

  if (typeof raw.name !== "string") return err(malformed(index, "name is required"));
  const nameProblem = checkEventName(raw.name, index);
  if (nameProblem !== null) return err(nameProblem);

  // Not trimmed. Rewriting a name to make it valid hides the client bug and
  // leaves two spellings of one event in the dictionary, which is the exact
  // failure `os-name.ts` exists to undo.
  const name = raw.name;

  if (!isVisitId(raw.visitId)) {
    return err(malformed(index, "visitId is required and must be a non-empty identifier"));
  }
  const visit = VisitId(raw.visitId);

  const person = admitOptionalPerson(raw.userId);
  if (!person.ok) return err(person.error);

  const occurredAt = parseOccurredAt(raw.occurredAt, batch.receivedAt, index);
  if (!occurredAt.ok) return err(occurredAt.error);

  const skew = checkSkew(occurredAt.value, batch.receivedAt, policy);
  if (skew !== null) return err(skew);

  const properties = admitProperties(raw.properties, index, policy);
  if (!properties.ok) return err(properties.error);

  const vocabulary = checkAgentVocabulary(name, properties.value, index);
  if (vocabulary !== null) return err(vocabulary);

  if (raw.idempotencyKey !== undefined && raw.idempotencyKey !== null && typeof raw.idempotencyKey !== "string") {
    return err(malformed(index, "idempotencyKey must be a string"));
  }
  const key = typeof raw.idempotencyKey === "string" && raw.idempotencyKey.length > 0 ? raw.idempotencyKey : null;

  return ok({
    name,
    visit,
    person: person.value,
    occurredAt: occurredAt.value,
    receivedAt: batch.receivedAt,
    dedupKey: key === null ? null : dedupKey(key, occurredAt.value),
    properties: properties.value,
    // `batch.country`, never `raw.systemProperties.country`. The client does
    // not get a say in where its events came from — see `country.ts`.
    system: normaliseSystemProperties(raw.systemProperties, batch.country),
  });
};

/**
 * Admit a batch.
 *
 * `Err` means nothing was admitted and the client should be told once. `Ok`
 * means some events are ready to commit and `rejected` names the rest by
 * index, so a client can fix them without guessing which of fifty it was.
 */
export const admit = (
  batch: IngestBatch,
  policy: AdmissionPolicy = DEFAULT_ADMISSION_POLICY,
): Result<AdmissionOutcome, BatchAdmissionError> => {
  if (batch.events.length > policy.maxEventsPerBatch) {
    return err({ kind: "BatchTooLarge", count: batch.events.length, max: policy.maxEventsPerBatch });
  }
  if (batch.bytes !== null && batch.bytes > policy.maxBodyBytes) {
    return err({ kind: "PayloadTooLarge", bytes: batch.bytes, max: policy.maxBodyBytes });
  }

  const passed: AdmittedEvent[] = [];
  const rejected: RejectedEvent[] = [];

  batch.events.forEach((raw, index) => {
    const result = admitEvent(raw, index, batch, policy);
    if (result.ok) passed.push(result.value);
    else rejected.push({ index, error: result.error });
  });

  const { unique, duplicates } = collapseDuplicates(passed);

  return ok({ admitted: unique, rejected, duplicates });
};
