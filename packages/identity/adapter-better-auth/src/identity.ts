/**
 * Wiring. One function, one object, no order of construction to get wrong.
 *
 * The port implementations are built from the same better-auth instance on
 * purpose. Two instances would mean two connection pools, two caches and two
 * answers to "is this person a member", and the second answer would be wrong
 * at exactly the moment it mattered. `memberships` is the directory and the
 * writer as one object for the same reason: a write and the read that
 * confirms it go through one adapter.
 *
 * The construction order below is the only one that works: the credential
 * store needs the membership directory to decide `IssuerNotAMember`, and the
 * membership directory needs the instance. The instance's own
 * `defaultPermissions` callback reads the member table directly rather than
 * through the directory, which is what keeps that from becoming a cycle — see
 * `auth.ts`.
 */

import type { Instant } from "@counted/kernel";
import type {
  AccountDirectory,
  CredentialStore,
  MembershipDirectory,
  MembershipWriter,
  OrganizationDirectory,
} from "@counted/identity-ports";
import { createIdentityAuth } from "./auth";
import { betterAuthOrganizationDirectory } from "./organization-directory";
import { betterAuthAccountDirectory } from "./account-directory";
import type { IdentityConfig } from "./config";
import { betterAuthCredentialStore } from "./credential-store";
import { betterAuthHttp, type IdentityHttp } from "./handler";
import { betterAuthMembershipDirectory } from "./membership-directory";
import { betterAuthMembershipWriter } from "./membership-writer";
import { ensureHoldingWorkspace, type HoldingWorkspace } from "./holding";
import { betterAuthWorkspaceProvisioner, type WorkspaceProvisioner } from "./provisioning";

export type Identity = {
  readonly accounts: AccountDirectory;
  readonly organizations: OrganizationDirectory;
  readonly memberships: MembershipDirectory & MembershipWriter;
  readonly credentials: CredentialStore;
  readonly workspaces: WorkspaceProvisioner;
  readonly http: IdentityHttp;
  /**
   * Create the holding workspace if it is not there. Called once at boot, on
   * the same instance everything else uses — a second better-auth instance
   * would mean a second pool and a second cache, and this writes rows the
   * first one immediately reads.
   */
  readonly holding: { ensure(at: Instant): Promise<HoldingWorkspace> };
};

/**
 * The same wiring, with the better-auth instance still attached.
 *
 * Not exported from the package. It exists so the port contract suites can run
 * against a real instance and still reach past the ports to *set the world up*
 * — `givenAccount`, `givenMember` — which is exactly what a contract harness
 * has to do and exactly what the ports refuse to let production code do.
 */
export const createIdentityWithAuth = (
  config: IdentityConfig,
  mountPath = "/api/auth",
): Identity & { readonly auth: ReturnType<typeof createIdentityAuth> } => {
  const identity = createIdentityAuth(config);
  const memberships: MembershipDirectory & MembershipWriter = {
    ...betterAuthMembershipDirectory(identity),
    ...betterAuthMembershipWriter(identity),
  };

  return {
    accounts: betterAuthAccountDirectory(identity),
    organizations: betterAuthOrganizationDirectory(identity, config.holding.workspace),
    memberships,
    credentials: betterAuthCredentialStore({
      identity,
      memberships,
      projects: config.projects,
      holding: config.holding.workspace,
    }),
    workspaces: betterAuthWorkspaceProvisioner(identity),
    holding: {
      ensure: (at) => ensureHoldingWorkspace(identity, config.holding, config.grants, at),
    },
    http: betterAuthHttp(identity, mountPath),
    auth: identity,
  };
};

export const createIdentity = (config: IdentityConfig, mountPath = "/api/auth"): Identity => {
  const { auth: _auth, ...identity } = createIdentityWithAuth(config, mountPath);
  return identity;
};
