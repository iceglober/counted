/**
 * Account, membership and credential shapes.
 *
 * The one rule that matters here: a credential's secret appears in exactly one
 * schema, `IssuedCredentialSchema`, returned by exactly two routes — issue and
 * rotate — and never again. `CredentialSchema` carries a `hint` instead, which
 * is the displayable fragment of the key, and `list` returns only that. v1's
 * key list endpoint returned the full key for every key the caller could see.
 */

import * as z from "zod";
import {
  AccountIdSchema,
  CredentialIdSchema,
  InstantSchema,
  PermissionSchema,
  ProjectIdSchema,
  RoleSchema,
  WorkspaceIdSchema,
} from "../primitives";

export const AccountSchema = z
  .object({
    id: AccountIdSchema,
    email: z.email(),
    name: z.string().nullable(),
    emailVerified: z.boolean(),
    createdAt: InstantSchema,
  })
  .meta({ id: "Account", description: "A person." });

export const MemberSchema = z
  .object({
    account: AccountSchema,
    role: RoleSchema,
    since: InstantSchema,
  })
  .meta({ id: "Member", description: "A person's standing in one workspace." });

export const CredentialKindSchema = z.enum(["ingest", "service"]);

/**
 * Four states, derived in one place in `@counted/projects-domain` and attached
 * here so the console has nothing to recompute. `expiring` is a real state
 * rather than a rendering decision — a key inside a rotation's grace window is
 * still usable and still needs replacing.
 */
export const CredentialStatusSchema = z.enum(["active", "expiring", "revoked", "expired"]);

export const CredentialSchema = z
  .object({
    id: CredentialIdSchema,
    kind: CredentialKindSchema,
    name: z.string(),
    hint: z.string().describe("The displayable fragment. Never the key."),
    workspace: WorkspaceIdSchema,
    project: ProjectIdSchema.nullable(),
    permissions: z.array(PermissionSchema),
    issuedBy: AccountIdSchema,
    status: CredentialStatusSchema,
    createdAt: InstantSchema,
    expiresAt: InstantSchema.nullable(),
    lastUsedAt: InstantSchema.nullable(),
    revokedAt: InstantSchema.nullable(),
  })
  .meta({ id: "Credential", description: "An API key, without its secret." });

/**
 * The only shape carrying a secret, and the only moment it exists outside the
 * caller's own storage. There is no route that returns it a second time.
 */
export const IssuedCredentialSchema = z
  .object({
    credential: CredentialSchema,
    secret: z
      .string()
      .describe("Shown once, at issuance. Counted stores a hash and cannot show it again."),
  })
  .meta({ id: "IssuedCredential", description: "A newly minted key and its secret." });

/**
 * Rotation is create-new plus expire-old, so it returns both halves. The
 * retiring key stays usable for the overlap window, which is what makes it
 * possible to replace a leaked key without a gap in ingest.
 */
export const RotatedCredentialSchema = z
  .object({
    issued: IssuedCredentialSchema,
    retiring: CredentialSchema,
  })
  .meta({ id: "RotatedCredential", description: "The replacement and the key it replaces." });

/**
 * What a credential can tell you about itself. The route behind this is what an
 * agent calls straight after provisioning, to learn which project it is holding
 * a key for without having a console session to ask.
 */
export const CredentialIdentitySchema = z
  .object({
    id: CredentialIdSchema,
    kind: CredentialKindSchema,
    workspace: WorkspaceIdSchema,
    project: ProjectIdSchema.nullable(),
    permissions: z.array(PermissionSchema),
    issuedBy: AccountIdSchema,
  })
  .meta({ id: "CredentialIdentity", description: "Who the calling credential is." });
