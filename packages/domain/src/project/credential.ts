/**
 * Credentials.
 *
 * v1 had three columns — `apiKey` (NOT NULL, legacy), `clientKey` (nullable,
 * real) and `serverKey` — compared in plaintext by equality, with one key of
 * each kind at most and no revocation. `generateApiKey()` was deprecated and
 * returned a `ck_` key, so the signup path wrote a `ck_` value into `apiKey`
 * and left `clientKey` NULL; ingest resolved `ck_` against `clientKey`, so the
 * key the UI showed the user could never ingest. That whole class of bug is
 * unrepresentable here: a credential is one thing, it has a kind, and a project
 * holds a set of them.
 *
 * The domain never sees a secret. An adapter mints the secret and hashes it;
 * the domain stores only the digest and a display prefix. That is also why
 * there is no `verify(secret)` here — the caller hashes, then presents a
 * digest.
 */

import type { Brand } from "../shared/brand";
import type { CredentialId } from "../shared/ids";
import type { Instant } from "../shared/instant";
// The scope vocabulary is authorization's, not the credential's — one
// list, shared by roles and keys alike, so the two cannot disagree.
import type { Scope } from "../access/scope";

/** The hash of a secret. Never the secret. */
export type CredentialDigest = Brand<string, "CredentialDigest">;
export const CredentialDigest = (raw: string): CredentialDigest => raw as CredentialDigest;

/**
 * The first few characters of the secret, kept so a human can tell two
 * credentials apart in a list. Not sensitive, not sufficient to authenticate.
 */
export type CredentialPrefix = Brand<string, "CredentialPrefix">;
export const CredentialPrefix = (raw: string): CredentialPrefix => raw as CredentialPrefix;

export type CredentialKind = "ingest" | "service";

export type Credential = {
  readonly id: CredentialId;
  readonly kind: CredentialKind;
  readonly label: string;
  readonly digest: CredentialDigest;
  readonly prefix: CredentialPrefix;
  readonly scopes: readonly Scope[];
  readonly issuedAt: Instant;
  /** Set when a rotation puts this credential into its grace window. */
  readonly expiresAt: Instant | null;
  readonly revokedAt: Instant | null;
};

export const Credential = {
  /** Usable means: not revoked, and not past its expiry at this instant. */
  isUsable: (c: Credential, at: Instant): boolean => {
    if (c.revokedAt !== null) return false;
    if (c.expiresAt !== null && c.expiresAt <= at) return false;
    return true;
  },

  isRevoked: (c: Credential): boolean => c.revokedAt !== null,

  /** In its rotation grace window: still working, but on the way out. */
  isExpiring: (c: Credential, at: Instant): boolean =>
    c.revokedAt === null && c.expiresAt !== null && c.expiresAt > at,

  grants: (c: Credential, scope: Scope): boolean => c.scopes.includes(scope),

  revoke: (c: Credential, at: Instant): Credential => ({ ...c, revokedAt: at }),
  expireAt: (c: Credential, at: Instant): Credential => ({ ...c, expiresAt: at }),
} as const;
