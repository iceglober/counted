/**
 * The rules about credentials. Not the credentials.
 *
 * better-auth's api-key plugin owns every row; this file
 * owns every question you can ask about one without touching storage. It is
 * pure by rule — `domain-is-pure` forbids importing `@counted/identity-ports`,
 * so the shapes below are structural: a `CredentialSummary` from that package
 * satisfies `CredentialFacts` without either side knowing about the other.
 * `packages/projects/app/src/credentials.test.ts` is where that compatibility
 * is actually proven, because that is the layer allowed to hold both types.
 *
 * The one thing worth reading twice is `credentialStatus`. Everything else
 * here — usable, revocable, rotatable — is derived from it, so there is exactly
 * one place that decides what state a key is in.
 */

import {
  err,
  Instant,
  ok,
  type CredentialId,
  type Result,
} from "@counted/kernel";
import type { ProjectError } from "./errors";

/**
 * Two kinds, two better-auth `configId`s, two prefixes.
 *
 * Mirrors `CredentialKind` in `@counted/identity-ports` and must stay identical
 * to it. The duplication is forced: a domain package may not import a ports
 * package, and both are the same closed string union, so assignment works in
 * both directions and the compiler catches a drift the moment `app` passes one
 * to the other.
 */
export type CredentialKind = "ingest" | "service";

/**
 * The subset of a credential that any rule here needs. Deliberately smaller
 * than `CredentialSummary`: a rule that does not read `hint` should not be able
 * to depend on it.
 */
export type CredentialFacts = {
  readonly id: CredentialId;
  readonly kind: CredentialKind;
  readonly name: string;
  /** Set by a rotation, which is what puts a key into its grace window. */
  readonly expiresAt: Instant | null;
  readonly revokedAt: Instant | null;
};

/**
 * Four states, and the reason there are four.
 *
 * The v2 console re-derived its own two-state version from `revokedAt` alone,
 * so a key mid-rotation looked identical to a key nobody had touched. Rotation
 * — the whole point of which is that there is a window where two keys work —
 * was invisible in the one place a human would look to check it had happened.
 *
 *   `active`    no expiry, not revoked. The normal state.
 *   `expiring`  has an expiry still in the future. It works, and it is going
 *               away. This is what rotation produces.
 *   `expired`   its expiry has passed. Does not authenticate.
 *   `revoked`   deliberately killed. Does not authenticate.
 */
export type CredentialStatus = "active" | "expiring" | "revoked" | "expired";

/**
 * The single derivation. Export this, not the booleans behind it — a client
 * that recomputes "is it dead" from two nullable timestamps will get a
 * different answer than the server eventually, and rotation is exactly where
 * it will differ.
 *
 * Revocation outranks expiry: a key that was revoked and then aged out is still
 * best described by the deliberate act, not the passage of time.
 */
export const credentialStatus = (c: CredentialFacts, at: Instant): CredentialStatus => {
  if (c.revokedAt !== null) return "revoked";
  if (c.expiresAt === null) return "active";
  return Instant.isAfter(c.expiresAt, at) ? "expiring" : "expired";
};

/**
 * Whether a key authenticates right now. An expiring key does — that is what
 * the overlap window is for, and treating it as dead would make rotation cut
 * clients off at the instant it is supposed to protect them.
 */
export const isUsable = (c: CredentialFacts, at: Instant): boolean => {
  const status = credentialStatus(c, at);
  return status === "active" || status === "expiring";
};

/**
 * Generic in the element type so a caller holding richer records — a
 * `CredentialSummary` from `@counted/identity-ports`, say — gets those back
 * rather than the narrowed facts. Without it every caller would need a cast at
 * exactly the boundary a cast is most likely to be wrong.
 */
export const usableCredentials = <C extends CredentialFacts>(
  credentials: readonly C[],
  at: Instant,
): readonly C[] => credentials.filter((c) => isUsable(c, at));

export const usableIngestCredentials = <C extends CredentialFacts>(
  credentials: readonly C[],
  at: Instant,
): readonly C[] => credentials.filter((c) => c.kind === "ingest" && isUsable(c, at));

/**
 * Whether the project can receive events at all. One usable ingest key is the
 * whole requirement — service keys cannot ingest, and an expiring key still
 * can.
 */
export const canIngest = (credentials: readonly CredentialFacts[], at: Instant): boolean =>
  usableIngestCredentials(credentials, at).length > 0;

/**
 * Two keys with the same name in one list is a support ticket waiting to
 * happen: the human revokes the wrong one. Retired keys do not reserve their
 * name — reusing "production" after revoking the old one is the normal case.
 */
export const nameIsAvailable = (
  credentials: readonly CredentialFacts[],
  name: string,
  at: Instant,
): Result<string, ProjectError> => {
  const trimmed = name.trim();
  if (trimmed.length === 0) return err({ kind: "NameRequired" });
  const clash = credentials.find((c) => isUsable(c, at) && c.name === trimmed);
  if (clash !== undefined) return err({ kind: "CredentialExists", credential: clash.id });
  return ok(trimmed);
};

/**
 * Find a credential and say why it cannot be acted on, in the order a human
 * would want to hear it: it does not exist, it is already dead, it aged out.
 */
const live = <C extends CredentialFacts>(
  credentials: readonly C[],
  target: CredentialId,
  at: Instant,
): Result<C, ProjectError> => {
  const found = credentials.find((c) => c.id === target);
  if (found === undefined) return err({ kind: "UnknownCredential", credential: target });
  switch (credentialStatus(found, at)) {
    case "revoked":
      return err({ kind: "CredentialRevoked", credential: target });
    case "expired":
      return err({ kind: "CredentialExpired", credential: target });
    default:
      return ok(found);
  }
};

/**
 * **You may not revoke your last usable ingest key.**
 *
 * A precondition, checked before the delete, returning a typed refusal rather
 * than throwing — a project that cannot receive events is not a state one click
 * should reach, and "your data stopped arriving" is the most expensive failure
 * this product has.
 *
 * Note what counts as remaining cover: any *usable* ingest key, which includes
 * one inside a rotation grace window. Cutting an overlap short is allowed;
 * cutting the last one is not.
 */
export const mayRevoke = <C extends CredentialFacts>(
  credentials: readonly C[],
  target: CredentialId,
  at: Instant,
): Result<C, ProjectError> => {
  const found = live(credentials, target, at);
  if (!found.ok) return found;

  if (found.value.kind === "ingest") {
    const remaining = usableIngestCredentials(credentials, at).filter((c) => c.id !== target);
    if (remaining.length === 0) return err({ kind: "LastIngestCredential", credential: target });
  }
  return found;
};

/**
 * Whether a credential can be rotated, and whether it is the kind the caller
 * thought it was.
 *
 * `expected` guards a confusion the console can produce: the ingest-key panel
 * and the service-key panel both post an id to the same route, and rotating a
 * service key from the ingest panel would hand the operator a `ck_` secret for
 * something that was never an ingest key. Pass `null` when the caller genuinely
 * does not care.
 */
export const mayRotate = <C extends CredentialFacts>(
  credentials: readonly C[],
  target: CredentialId,
  expected: CredentialKind | null,
  at: Instant,
): Result<C, ProjectError> => {
  const found = live(credentials, target, at);
  if (!found.ok) return found;
  if (expected !== null && found.value.kind !== expected) {
    return err({ kind: "RotationKindMismatch" });
  }
  return found;
};
