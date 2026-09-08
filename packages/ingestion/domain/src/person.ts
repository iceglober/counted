/**
 * A person is not a visit, and there is exactly one way one enters the system.
 *
 * `VisitId` and `PersonId` are separate brands in the kernel, and this module
 * is the only place a `PersonId` is ever produced from ingest input — from an
 * explicit `userId` the customer supplied through `identify()`. Nothing here
 * derives one from a visit, a device, an IP or a hash of any of them.
 *
 * The reason is a v1 bug with a two-word summary: "unique users" was a count
 * of distinct `session_id`, and a session id rolled over after 30 minutes
 * idle. So one person browsing across a week counted as thirty users, the
 * retention chart cohorted on an id that expired four times an hour, and the
 * chart read approximately zero forever. The brands make that substitution a
 * compile error; this module makes sure the only source of the branded value
 * is a deliberate call.
 */

import { PersonId } from "@counted/kernel";
import type { Result } from "@counted/kernel";
import { err, ok } from "@counted/kernel";

import type { EventAdmissionError } from "./errors";

/**
 * Long enough for a uuid, a Stripe customer id or an internal integer; short
 * enough that it cannot be a smuggled JSON blob of profile data.
 */
export const MAX_PERSON_ID_LENGTH = 128;

/**
 * Something with an `@` and a dot after it.
 *
 * Deliberately loose. This is not address validation — it is a refusal to
 * store the thing the product promises it does not store. A false positive
 * costs a customer one line of code to hash their id; a false negative puts an
 * email address in an analytics database whose entire pitch is that it holds
 * no personal data.
 */
const LOOKS_LIKE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Turn a customer-supplied identifier into a `PersonId`, or say why not.
 *
 * `null` and `undefined` are *not* errors here — an event with no identify()
 * behind it simply has no person, and the caller passes it through
 * `admitOptionalPerson`. `PersonIdRequired` is for a present-but-empty value,
 * which is a client bug (`identify(user.id)` where `user.id` was `""`) rather
 * than an anonymous event.
 */
export const admitPersonId = (raw: unknown): Result<PersonId, EventAdmissionError> => {
  if (typeof raw !== "string") return err({ kind: "PersonIdRequired" });

  const trimmed = raw.trim();
  if (trimmed.length === 0) return err({ kind: "PersonIdRequired" });
  if (trimmed.length > MAX_PERSON_ID_LENGTH) {
    return err({ kind: "PersonIdTooLong", length: trimmed.length, max: MAX_PERSON_ID_LENGTH });
  }
  if (LOOKS_LIKE_EMAIL.test(trimmed)) return err({ kind: "PersonIdLooksLikeEmail" });

  return ok(PersonId(trimmed));
};

/**
 * The same rules, with "no person at all" as a legitimate answer.
 *
 * Most events have no person. Treating absence as a rejection would refuse
 * every event from a customer who never calls `identify()`, which is most of
 * them.
 */
export const admitOptionalPerson = (raw: unknown): Result<PersonId | null, EventAdmissionError> =>
  raw === undefined || raw === null ? ok(null) : admitPersonId(raw);
