/**
 * PersonId — a durable identifier, supplied by the customer.
 *
 * This is the one identifier in the system that survives a visit, and Counted
 * never derives, infers, or invents it. It arrives because the customer's own
 * application called `identify()` with an id it already had.
 *
 * The invariant is enforced structurally: there is **no exported constructor**
 * for `PersonId`. `identify()` is the only function in the codebase that can
 * produce one, so "where could a person id have come from?" has exactly one
 * answer, and grep proves it. Contrast v1, where `unique_users` was a public
 * API measure that silently compiled to `COUNT(DISTINCT session_id)` — a lie
 * the type system had no way to catch.
 *
 * `identify()` also refuses values that are obviously personal data. A
 * customer who passes an email address has just put PII in a system whose
 * entire promise is that it holds none. Better to fail loudly at the call site
 * than to store it and be quietly wrong about our own marketing.
 */

import type { Brand } from "../shared/brand";
import { err, ok, type Result } from "../shared/result";

export type PersonId = Brand<string, "PersonId">;

export const MAX_PERSON_ID_LENGTH = 200;

export type IdentifyError =
  | { kind: "PersonIdRequired" }
  | { kind: "PersonIdTooLong"; length: number; max: number }
  | { kind: "PersonIdLooksLikeEmail" };

/**
 * Rough, deliberately conservative: something@something.tld. The goal is to
 * catch the common mistake, not to validate email addresses.
 */
const LOOKS_LIKE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The only way to obtain a PersonId.
 *
 * Takes the raw identifier the customer's application already uses for its own
 * account — a database id, a UUID, a hashed subject. Anything opaque.
 */
export const identify = (raw: string): Result<PersonId, IdentifyError> => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return err({ kind: "PersonIdRequired" });
  if (trimmed.length > MAX_PERSON_ID_LENGTH) {
    return err({ kind: "PersonIdTooLong", length: trimmed.length, max: MAX_PERSON_ID_LENGTH });
  }
  if (LOOKS_LIKE_EMAIL.test(trimmed)) return err({ kind: "PersonIdLooksLikeEmail" });
  return ok(trimmed as PersonId);
};

/** Read the raw value back, for storage and for the wire. */
export const personIdValue = (id: PersonId): string => id as string;
