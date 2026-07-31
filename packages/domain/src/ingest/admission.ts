/**
 * Deciding what happens to each event in a batch.
 *
 * This is the whole of ingestion's business logic, and it is a pure function.
 * No clock, no database, no HTTP — the receipt a request will return is
 * computed here and can be asserted exhaustively without any of that.
 *
 * The rule that shapes everything: **one bad event does not reject a batch,
 * and no event is ever discarded silently.** Every event gets a disposition,
 * every disposition is reported, and the three failure modes are distinct:
 *
 *   `rejected` — the event is malformed. Resending it unchanged will not help.
 *   `dropped`  — the event is fine, the workspace is over quota. Not stored.
 *   `accepted` — stored (or recognised as already stored).
 *
 * v1 collapsed the middle case into success: past the hard limit it returned
 * `202` with an empty body and threw the event away, byte-identical to a
 * successful write. A customer could be losing every event and see nothing but
 * 202s.
 *
 * Ingestion has no aggregate on purpose. There is no stored root whose
 * invariants a batch could violate — the transactional unit is the batch
 * itself, and this function is what it means.
 */

import { identify, type PersonId } from "../identity/person";
import { VisitId } from "../identity/visit";
import { Subject } from "../identity/subject";
import type { Instant } from "../shared/instant";
import type { ProjectId } from "../shared/ids";
import { Quota, type QuotaDecision } from "../billing/quota";
import { readPlatform, type Platform } from "./platform";
import { validateAgentEvent } from "./gen/vocabulary";

/** Limits the domain owns. The wire schema enforces its own; these are truth. */
export const MAX_EVENTS_PER_BATCH = 250;
export const MAX_EVENT_NAME_LENGTH = 200;
export const MAX_PROPERTIES = 50;
/** How far ahead of the server's clock a client timestamp may sit. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** How far back. Older than this is almost always a broken device clock. */
export const MAX_BACKDATE_MS = 90 * 24 * 60 * 60 * 1000;

export type PropertyValue = string | number | boolean | null;

/** An event as it arrived, already parsed but not yet judged. */
export type SubmittedEvent = {
  readonly name: string;
  readonly visitId: string;
  /** Present only when the customer's app called identify(). */
  readonly userId?: string | undefined;
  readonly occurredAt?: Instant | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly properties?: Readonly<Record<string, PropertyValue>> | undefined;
  readonly systemProperties?: Readonly<Record<string, string | null>> | undefined;
};

export type RefusalReason =
  | { readonly code: "name_empty" }
  | { readonly code: "name_too_long"; readonly length: number; readonly max: number }
  | { readonly code: "visit_missing" }
  | { readonly code: "too_many_properties"; readonly count: number; readonly max: number }
  | { readonly code: "person_id_invalid"; readonly detail: string }
  | { readonly code: "occurred_at_in_future"; readonly skewMs: number }
  | { readonly code: "occurred_at_too_old"; readonly ageMs: number }
  | { readonly code: "agent_vocabulary"; readonly detail: string };

export type Warning =
  | { readonly index: number; readonly code: "platform_unrecognised"; readonly detail: string }
  | { readonly index: number; readonly code: "occurred_at_missing" };

/** An event that will be written. */
export type AdmittedEvent = {
  readonly index: number;
  readonly project: ProjectId;
  readonly name: string;
  readonly occurredAt: Instant;
  readonly subject: Subject;
  /**
   * Present always. Defaulted when the client did not supply one, so the
   * dedup key is never null and the unique index always applies.
   */
  readonly idempotencyKey: string;
  readonly properties: Readonly<Record<string, PropertyValue>>;
  readonly system: Readonly<Record<string, string | null>>;
  readonly platform: Platform;
};

export type Disposition =
  | { readonly index: number; readonly kind: "accepted" }
  | { readonly index: number; readonly kind: "dropped"; readonly reason: "quota_exceeded" }
  | { readonly index: number; readonly kind: "rejected"; readonly reason: RefusalReason };

export type Admission = {
  /** In submission order. Only these reach the writer. */
  readonly admitted: readonly AdmittedEvent[];
  /** One per submitted event, in submission order. Never shorter. */
  readonly dispositions: readonly Disposition[];
  readonly warnings: readonly Warning[];
  readonly quota: QuotaDecision;
};

export type AdmissionInput = {
  readonly project: ProjectId;
  readonly events: readonly SubmittedEvent[];
  /** The server's clock, passed in. The domain does not have one. */
  readonly receivedAt: Instant;
  readonly quota: QuotaDecision;
};

const trimmed = (raw: string): string => raw.trim();

/**
 * A dedup key for an event that did not bring one.
 *
 * Derived from the event's own content, so a retry of the identical event
 * produces the identical key and deduplicates — which is the property that
 * makes at-least-once delivery safe. It deliberately does *not* include
 * anything random or clock-derived.
 *
 * Two genuinely distinct events with the same name, visit and millisecond do
 * collapse into one. That is the honest trade: without a client-supplied key
 * we cannot tell that case apart from a retry, and silently double-counting a
 * retry is the worse error.
 */
const derivedKey = (event: SubmittedEvent, occurredAt: Instant): string => {
  const properties = event.properties ?? {};
  const shape = Object.keys(properties)
    .sort()
    .map((k) => `${k}=${String(properties[k])}`)
    .join("&");
  return `d:${event.visitId}:${trimmed(event.name)}:${String(occurredAt)}:${shape}`;
};

const validate = (
  event: SubmittedEvent,
  receivedAt: Instant,
): { readonly ok: true; readonly occurredAt: Instant; readonly person: PersonId | null } | { readonly ok: false; readonly reason: RefusalReason } => {
  const name = trimmed(event.name);
  if (name.length === 0) return { ok: false, reason: { code: "name_empty" } };
  if (name.length > MAX_EVENT_NAME_LENGTH) {
    return { ok: false, reason: { code: "name_too_long", length: name.length, max: MAX_EVENT_NAME_LENGTH } };
  }

  if (trimmed(event.visitId).length === 0) return { ok: false, reason: { code: "visit_missing" } };

  // Anything claiming the `agent_` prefix is held to the agent vocabulary,
  // whatever sent it. The SDK checks this too, on the developer's machine,
  // where a wrong event fails next to the line that wrote it — but a check
  // that only the SDK performs is a check an old client, a curl, or somebody's
  // own script skips, and the agent dashboards are built on these names
  // meaning one thing. Both sides read the same generated module.
  const vocabulary = validateAgentEvent(name, event.properties ?? {});
  if (vocabulary !== null) {
    return { ok: false, reason: { code: "agent_vocabulary", detail: vocabulary.problems.join("; ") } };
  }

  const propertyCount = Object.keys(event.properties ?? {}).length;
  if (propertyCount > MAX_PROPERTIES) {
    return { ok: false, reason: { code: "too_many_properties", count: propertyCount, max: MAX_PROPERTIES } };
  }

  // The clock the SDK stamped at track() time, held through its retry queue.
  // Absent means "now" — which is only right for events that did not sit in a
  // queue, so it is warned about rather than treated as equivalent.
  const occurredAt = event.occurredAt ?? receivedAt;
  const skew = Number(occurredAt) - Number(receivedAt);
  if (skew > MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: { code: "occurred_at_in_future", skewMs: skew } };
  }
  if (-skew > MAX_BACKDATE_MS) {
    return { ok: false, reason: { code: "occurred_at_too_old", ageMs: -skew } };
  }

  // The only way a PersonId enters the system. `identify` refuses anything
  // that looks like an email address, because a customer who passes one has
  // just put PII into a product whose promise is that it holds none.
  let person: PersonId | null = null;
  if (event.userId !== undefined) {
    const identified = identify(event.userId);
    if (!identified.ok) {
      return { ok: false, reason: { code: "person_id_invalid", detail: identified.error.kind } };
    }
    person = identified.value;
  }

  return { ok: true, occurredAt, person };
};

export const admit = (input: AdmissionInput): Admission => {
  const dispositions: Disposition[] = [];
  const admitted: AdmittedEvent[] = [];
  const warnings: Warning[] = [];

  // Quota is decided once for the batch, not per event: a batch that straddles
  // the limit is accepted or dropped as a whole. Splitting it would make the
  // receipt depend on the order events happen to sit in the array.
  const storing = Quota.accepts(input.quota);

  input.events.forEach((event, index) => {
    const checked = validate(event, input.receivedAt);
    if (!checked.ok) {
      // Malformed events are rejected whatever the quota says. Reporting
      // "over quota" for an event that could never be stored anyway would
      // send the customer to fix the wrong thing.
      dispositions.push({ index, kind: "rejected", reason: checked.reason });
      return;
    }

    if (!storing) {
      dispositions.push({ index, kind: "dropped", reason: "quota_exceeded" });
      return;
    }

    if (event.occurredAt === undefined) warnings.push({ index, code: "occurred_at_missing" });

    const system = { ...(event.systemProperties ?? {}) };
    const reading = readPlatform(system["os_name"]);
    if (reading.unrecognised && reading.raw !== null) {
      warnings.push({ index, code: "platform_unrecognised", detail: reading.raw });
    }
    system["os_name"] = reading.platform;
    system["os_name_raw"] = reading.raw;

    admitted.push({
      index,
      project: input.project,
      name: trimmed(event.name),
      occurredAt: checked.occurredAt,
      subject:
        checked.person === null
          ? Subject.anonymous(VisitId(trimmed(event.visitId)))
          : Subject.identified(VisitId(trimmed(event.visitId)), checked.person),
      idempotencyKey: event.idempotencyKey ?? derivedKey(event, checked.occurredAt),
      properties: event.properties ?? {},
      system,
      platform: reading.platform,
    });
    dispositions.push({ index, kind: "accepted" });
  });

  return { admitted, dispositions, warnings, quota: input.quota };
};

/** Counts for the receipt. Derived, so they cannot disagree with the list. */
export const tally = (
  dispositions: readonly Disposition[],
): { readonly accepted: number; readonly dropped: number; readonly rejected: number } => {
  let accepted = 0;
  let dropped = 0;
  let rejected = 0;
  for (const d of dispositions) {
    if (d.kind === "accepted") accepted += 1;
    else if (d.kind === "dropped") dropped += 1;
    else rejected += 1;
  }
  return { accepted, dropped, rejected };
};

/** Human-readable, for the receipt. One sentence, no jargon. */
export const explainRefusal = (reason: RefusalReason): string => {
  switch (reason.code) {
    case "name_empty":
      return "An event name is required.";
    case "name_too_long":
      return `The event name is ${reason.length} characters; the maximum is ${reason.max}.`;
    case "visit_missing":
      return "A visitId is required.";
    case "too_many_properties":
      return `The event carries ${reason.count} properties; the maximum is ${reason.max}.`;
    case "person_id_invalid":
      return reason.detail === "PersonIdLooksLikeEmail"
        ? "The userId looks like an email address. Send an opaque identifier instead — Counted stores no personal data."
        : "The userId is not a usable identifier.";
    case "occurred_at_in_future":
      return `occurredAt is ${Math.round(reason.skewMs / 1000)}s in the future; check the device clock.`;
    case "occurred_at_too_old":
      return `occurredAt is ${Math.round(reason.ageMs / 86_400_000)} days old, beyond the ingestion window.`;
    case "agent_vocabulary":
      return `The event uses the reserved \`agent_\` prefix but does not match the agent vocabulary: ${reason.detail}`;
  }
};
