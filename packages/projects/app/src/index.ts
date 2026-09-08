/**
 * @counted/projects-app — project use cases.
 *
 * Provisioning, renaming, archiving, deleting, and the credential lifecycle.
 * The rotation *window* lives here rather than in the domain because "how long
 * does the old key keep working" is a product decision, not a rule about what a
 * credential is.
 *
 * Two things this package deliberately does not do:
 *
 *   It does not decide authorization. `@counted/authorization` is not on its
 *   import list; the decision runs in `apps/*` before a use case is called, and
 *   what arrives here is the issuer's already-expanded permission set as a
 *   value (V3-SPEC §7).
 *
 *   It does not pretend the credential store shares a transaction with the
 *   project repository. It does not — better-auth owns those tables — so each
 *   use case orders its writes and says which intermediate state survives a
 *   crash. See `provision.ts`.
 *
 * **The no-signup path is here now.** `provisionUnclaimedProject` was missing
 * because `IssueRequest.workspace` is a non-null `WorkspaceId` an unclaimed
 * project does not have. It stays non-null: a key's permissions are derived
 * from the issuing account's *role*, a role only exists inside a workspace, so
 * a workspace-less credential would need a second derivation rule beside
 * `CredentialGrants` — the one thing `credential-kind.ts` exists to prevent.
 * Every unclaimed project is born into a holding workspace instead, which the
 * identity adapter creates at boot (`ensureHoldingWorkspace`), and identity's
 * `ProjectPlacement` now distinguishes "unclaimed" from "no such project" so
 * issuance can tell them apart. It could not before, and refused every
 * anonymous provision there has ever been.
 */

export * from "./credentials";
export * from "./lifecycle";
export * from "./ports";
export * from "./provision";
export * from "./rotation";
