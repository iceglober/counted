/**
 * The two kinds of machine credential, and the one rule that decides what each
 * one may do.
 *
 * v2 let the caller name a credential's scopes in the request body. Issuing
 * required `credentials:write`, which an admin holds, while `workspace:admin`
 * and `billing:write` are owner-only — so an admin could mint a service key
 * carrying owner permissions and then act through it. The escalation was not a
 * missing check; it was a field that should never have existed.
 *
 * v3 removes the field (`IssueRequest` has no `permissions`) and puts the
 * derivation here, where every implementation — the in-memory fake, the
 * better-auth adapter, and whatever replaces it — computes the same set from
 * the same two inputs: the kind, and what the issuer's role already grants.
 *
 * **Nothing here is a grant table and nothing here is a ceiling.**
 * `@counted/authorization` owns the table and `@counted/projects-domain` owns
 * the credential-kind ceiling; a ports package may import neither
 * (`ports-declare-only`). Both arrive already composed, as the
 * `CredentialGrants` function below, supplied by the composition root.
 *
 * This package used to state the ceiling itself — an `INGEST_PERMISSIONS`
 * constant and a `grantablePermissions` that capped `service` at everything
 * the role held. That was a third copy of the rule and it was the loosest of
 * them: an owner's service key came back carrying `workspace:admin` and
 * `billing:write`, which `withinGrant` in the projects app then refused, so
 * the key was minted and immediately revoked and no owner could issue a
 * service key at all.
 */

import type { Permission, Role } from "@counted/kernel";

/**
 * `ingest` keys are **public**. They ship inside browser bundles and mobile
 * binaries where anyone can read them, so they are rate-limited and fixed to a
 * single permission — a leaked ingest key can add junk events and nothing else.
 * `service` keys are secret, live on a server, and carry whatever the issuing
 * account's role already grants.
 */
export type CredentialKind = "ingest" | "service";

export const CREDENTIAL_KINDS: readonly CredentialKind[] = ["ingest", "service"];

export const isCredentialKind = (value: unknown): value is CredentialKind =>
  typeof value === "string" && (CREDENTIAL_KINDS as readonly string[]).includes(value);

/**
 * The prefix carried by the secret itself, so a key found in a log or a git
 * history can be classified without a database lookup — which is what makes
 * automated secret scanning possible. Two prefixes, two `configId`s in
 * `@better-auth/api-key`, one distinction.
 */
export const CREDENTIAL_PREFIX = {
  ingest: "ck_",
  service: "sk_",
} as const satisfies Record<CredentialKind, string>;

/**
 * Classify a presented secret by its prefix alone. Answers "which key store
 * should I look in", never "is this key valid" — an attacker controls this
 * string, so the answer is a routing hint and nothing more.
 */
export const credentialKindOf = (secret: string): CredentialKind | null => {
  for (const kind of CREDENTIAL_KINDS) {
    if (secret.startsWith(CREDENTIAL_PREFIX[kind])) return kind;
  }
  return null;
};

/**
 * How many characters of a secret a hint may reveal past its prefix. Enough to
 * tell two keys apart in a list; not enough to narrow a guess.
 */
export const CREDENTIAL_HINT_REVEALED = 4;

/**
 * The display stub shown in a key list, e.g. `ck_a1b2…`.
 *
 * The trailing ellipsis is load-bearing rather than decorative: it is what
 * makes the hint fail a substring test against the secret, which is the
 * property the port contract test asserts. A hint that is a verbatim slice of
 * a live secret is a leak with a smaller font.
 */
export const credentialHint = (secret: string): string => {
  const kind = credentialKindOf(secret);
  const prefix = kind === null ? "" : CREDENTIAL_PREFIX[kind];
  return `${prefix}${secret.slice(prefix.length, prefix.length + CREDENTIAL_HINT_REVEALED)}…`;
};

/**
 * The permissions a credential of this kind, issued by an account holding this
 * role, may carry — passed in rather than computed here.
 *
 * Both halves of the rule are already inside it when it arrives:
 *
 * - **Role caps the set.** Nothing survives that the issuer does not hold.
 *   That is authorization's third question, and the expansion belongs to
 *   `@counted/authorization`, the only package that may touch `accesscontrol`.
 * - **Kind caps it again.** An ingest key can only ever be `events:write`; a
 *   service key may not carry `workspace:admin` or `billing:write` even for an
 *   owner. That ceiling belongs to `@counted/projects-domain`, which states it
 *   as a pure function of the permissions held.
 *
 * A ports package may import neither, so the composition root supplies the
 * composition — `(kind, role) => grantableTo(kind, permissionsForRole(role))`.
 * The seam is not ceremony: it is what stops a third permission list appearing
 * next to the two real ones, which is exactly what happened when this package
 * computed the set itself.
 *
 * Empty means the issuer may not create this kind of key at all — the caller
 * turns that into `NothingGrantable`. Implementations must return the set in
 * `ALL_PERMISSIONS` order, so two stores that agree on the set also agree on
 * the array and a test can compare with `toEqual`.
 */
export type CredentialGrants = (
  kind: CredentialKind,
  role: Role,
) => readonly Permission[];
