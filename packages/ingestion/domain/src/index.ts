/**
 * @counted/ingestion-domain — admission, dedup, and the person/visit split.
 *
 * A visit id is generated on the client, lives in memory, and rolls over after
 * 30 minutes of inactivity; it is not stored in a cookie, in localStorage, or
 * on disk. A person id is durable and supplied by the customer. They are both
 * strings and they are never interchangeable — the kernel's brands enforce
 * that, and the rules that make a person id acceptable (not an email address,
 * within length) belong here, because they are policy rather than syntax.
 *
 * v1 cohorted retention on an id that expires four times an hour and reported
 * approximately zero forever. That is the mistake this separation prevents.
 *
 * The generated event vocabulary lands in `src/gen/vocabulary.ts` — run
 * `bun run contract:generate`; do not hand-edit it.
 */

export type { IngestBatch, PropertyValue, RawEvent } from "./batch";
export {
  admit,
  admitEvent,
  DEFAULT_ADMISSION_POLICY,
  type AdmissionOutcome,
  type AdmissionPolicy,
  type AdmittedEvent,
} from "./admission";
export { admitCountry, isCountryCode, type CountryCode } from "./country";
export { collapseDuplicates, dedupKey, type Deduplicable, type Deduplicated, type DedupKey } from "./dedup";
export type { AdmissionError, BatchAdmissionError, EventAdmissionError, RejectedEvent } from "./errors";
export { checkAgentVocabulary, checkEventName, MAX_EVENT_NAME_LENGTH } from "./event-name";
export { canonicalOsName, isOsName, OS_NAMES, type CanonicalOsName, type OsName } from "./os-name";
export { admitOptionalPerson, admitPersonId, MAX_PERSON_ID_LENGTH } from "./person";
export {
  MAX_SYSTEM_VALUE_LENGTH,
  normaliseSystemProperties,
  type SystemProperties,
} from "./system-properties";

/**
 * Re-exported so a caller that must speak the agent vocabulary — the API
 * layer answering "why was this refused" — does not import a generated file by
 * path.
 */
export {
  AGENT_EVENT_PREFIX,
  AGENT_EVENTS,
  claimsAgentVocabulary,
  isAgentEventName,
  type AgentEventName,
  type VocabularyValue,
} from "./gen/vocabulary";
