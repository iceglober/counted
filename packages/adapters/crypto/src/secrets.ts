/**
 * Minting and hashing credential secrets.
 *
 * This lives in an adapter because the domain forbids itself randomness and
 * I/O — which is also what makes every aggregate test deterministic without
 * patching globals.
 *
 * **The secret is shown exactly once**, at issue or rotation. Only its digest
 * is stored, so a database dump does not hand an attacker working keys. v1
 * stored keys in plaintext across three columns and compared them by equality.
 *
 * On the hash choice: SHA-256, not bcrypt or argon2. Those exist to make
 * *guessing* expensive, which matters for passwords because people choose them
 * badly. These secrets are 256 bits of CSPRNG output — there is no dictionary
 * to try, and a slow hash on the ingest hot path would cost every event a few
 * hundred milliseconds for no security gain.
 *
 * Lookup is by digest, and the digest is indexed. So verification is one
 * indexed read rather than a scan-and-compare, and there is no per-candidate
 * comparison whose timing could leak anything.
 */

import { createHash, randomBytes } from "node:crypto";
import { CredentialDigest, CredentialPrefix } from "@counted/domain";

/** How a secret announces what it is. Visible, and deliberately unmistakable. */
export const SECRET_PREFIXES = {
  /** Public. Ships in browser bundles and mobile apps. events:write only. */
  ingest: "ck",
  /** Secret. Server-side, scoped. */
  service: "sk",
} as const;

export type SecretKind = keyof typeof SECRET_PREFIXES;

/** 32 bytes ≈ 256 bits. Base64url so it is copy-pasteable and shell-safe. */
const SECRET_BYTES = 32;

export type IssuedSecret = {
  /** The full secret. Returned once and never stored. */
  readonly secret: string;
  /** What goes in the database. */
  readonly digest: CredentialDigest;
  /** Enough to tell two keys apart in a list. Not enough to authenticate. */
  readonly prefix: CredentialPrefix;
};

export const digestOf = (secret: string): CredentialDigest =>
  CredentialDigest(createHash("sha256").update(secret, "utf8").digest("hex"));

/**
 * A human-readable stub: the kind, and the first six characters of the random
 * part. Six base64url characters is ~36 bits — plenty to distinguish the keys
 * one project holds, and useless for guessing the other 220.
 */
export const displayPrefix = (secret: string): CredentialPrefix => {
  const [kind = "", body = ""] = secret.split("_", 2);
  return CredentialPrefix(`${kind}_${body.slice(0, 6)}`);
};

export const issueSecret = (kind: SecretKind): IssuedSecret => {
  const body = randomBytes(SECRET_BYTES).toString("base64url");
  const secret = `${SECRET_PREFIXES[kind]}_${body}`;
  return { secret, digest: digestOf(secret), prefix: displayPrefix(secret) };
};

/**
 * Which kind a presented secret claims to be, from its prefix alone.
 *
 * Used to reject an obvious category error before touching the database — a
 * service key offered for ingestion, say. It is a claim, not proof: what the
 * credential may actually do comes from its stored scopes.
 */
export const kindOf = (secret: string): SecretKind | null => {
  const prefix = secret.split("_", 1)[0];
  for (const [kind, p] of Object.entries(SECRET_PREFIXES)) {
    if (p === prefix) return kind as SecretKind;
  }
  return null;
};

/**
 * The SecretGenerator port, satisfied.
 *
 * `digest` deliberately does not take the kind: verification must work from
 * the presented string alone, or a caller could be tricked into hashing under
 * the wrong assumption.
 */
export const secretGenerator = {
  issue: (prefix: string): IssuedSecret => {
    const kind = (Object.entries(SECRET_PREFIXES).find(([, p]) => p === prefix)?.[0] ?? "service") as SecretKind;
    return issueSecret(kind);
  },
  digest: digestOf,
} as const;
