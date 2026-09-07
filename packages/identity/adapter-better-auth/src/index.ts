/**
 * @counted/identity-adapter-better-auth — better-auth behind the identity
 * ports.
 *
 * The only package in the repo that may import `better-auth` or
 * `@better-auth/*`; the `only-the-identity-adapter-knows-better-auth` rule in
 * .dependency-cruiser.cjs enforces it, `apps/api` included.
 *
 * **Nothing better-auth declares is exported from this file.** Every type
 * crossing this line is a kernel value object, an identity port, or a type
 * this package defined for the purpose. That is the test for whether this is
 * an adapter or just a place the library happens to be imported: if
 * `IdentityConfig` ever grows a field whose type comes from the vendor, every
 * app configuring identity starts importing better-auth and the boundary
 * becomes decoration.
 *
 * What is here:
 *
 *   `createIdentity`   the whole thing, wired: the better-auth instance, the
 *                      three port implementations, the HTTP surface and the
 *                      workspace provisioner.
 *   `IdentityConfig`   what the composition root decides.
 *
 * The four seams the composition root must fill, and why each is injected
 * rather than imported:
 *
 *   `grants`    `accesscontrol` belongs to `@counted/authorization` alone, so
 *               the role expansion arrives as a function. This is what stops a
 *               second permission table appearing next to the first.
 *   `projects`  identity has to answer `NoSuchProject` and cannot; the
 *               projects context owns that fact.
 *   `notifier`  email is a capability, not a vendor feature.
 *   `ids`       the only randomness in the system lives in one adapter.
 */

export { createIdentity, type Identity } from "./identity";

export type {
  IdentityConfig,
  IdentityDatabase,
  IdentityLogLevel,
  ProjectPlacement,
  ProjectPlacements,
  RateLimit,
  SessionPrincipal,
  SocialSignIn,
} from "./config";

/**
 * The holding workspace an anonymously provisioned project's ingest key is
 * issued against, created at boot rather than by hand. See `holding.ts`.
 */
export type { HoldingWorkspace } from "./holding";
export type { HoldingWorkspaceInput } from "./config";

export type { IdentityHttp } from "./handler";
export { isBlockedIdentityPath } from "./handler";

export type {
  NewWorkspace,
  ProvisionFailure,
  ProvisionedWorkspace,
  WorkspaceMirror,
  WorkspaceProvisioner,
} from "./provisioning";

/**
 * The permission representation. Exported because `apps/api` reads a
 * credential's permissions back off a verification and the shape is ours, not
 * better-auth's — but the translation stays in here.
 */
export type { PermissionStatements } from "./permissions";
export { fromStatements, toStatements } from "./permissions";

/** The role translation, exported for the one test that pins it. */
export { roleFrom } from "./role";

/**
 * The schema better-auth owns, applied from its own generator. The composition
 * root calls this at boot, after `applySchema` has created the `auth` schema
 * and before anything reads a member row.
 */
export {
  migrateIdentity,
  IdentityMigrationUnsupported,
  type IdentityMigrationOutcome,
} from "./migrate";
