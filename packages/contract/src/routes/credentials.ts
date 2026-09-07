/**
 * API keys.
 *
 * The request body has **no `permissions` field**, and never will. The key's
 * permission set is computed server-side from its kind and the issuer's role:
 * an ingest key is exactly `events:write`, and a service key is the
 * intersection of what was asked for with what the issuer holds. v2 accepted a
 * scope list from the client and checked it afterwards, which is how an admin
 * could mint a service key carrying the owner-only `workspace:admin` and act
 * through it. Removing the field removes the request that exploit was made of.
 *
 * `credentials.self` is the one route an ingest key can call. An agent that has
 * just provisioned a project holds a key and nothing else; this is how it
 * learns which project it is holding a key for.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";
import { route } from "../route";
import { AUTH_ERRORS, CREDENTIAL_ERRORS } from "../errors";
import {
  CredentialIdSchema,
  DurationMsSchema,
  PermissionSchema,
  ProjectIdSchema,
  WorkspaceIdSchema,
} from "../primitives";
import {
  CredentialIdentitySchema,
  CredentialKindSchema,
  CredentialSchema,
  IssuedCredentialSchema,
  RotatedCredentialSchema,
} from "../schemas/identity";

const TAGS = ["credentials"] as const;

export const list = oc
  .meta(
    route({
      id: "credentials.list",
      method: "GET",
      path: "/v1/projects/{projectId}/credentials",
      summary: "List a project's API keys",
      description:
        "Includes revoked keys: an audit needs them. Each entry carries its derived status, so nothing downstream recomputes expiry.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "credentials:read",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(CREDENTIAL_ERRORS)
  .input(z.object({ projectId: ProjectIdSchema }))
  .output(z.object({ items: z.array(CredentialSchema) }));

export const issue = oc
  .meta(
    route({
      id: "credentials.issue",
      method: "POST",
      path: "/v1/projects/{projectId}/credentials",
      summary: "Issue an API key",
      description:
        "The secret is in the response and nowhere else. `permissions` is a request for a ceiling, not a grant: the issued set is the intersection with what the issuer holds, and asking for more than that is refused rather than quietly trimmed.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "credentials:write",
        resource: "project",
        param: "projectId",
      },
      successStatus: 201,
    }),
  )
  .errors(CREDENTIAL_ERRORS)
  .input(
    z.object({
      projectId: ProjectIdSchema,
      kind: CredentialKindSchema,
      name: z.string().min(1).max(200),
      /**
       * Ignored for ingest keys, which are always exactly `events:write`.
       * Omitted for a service key means "everything the issuer holds".
       */
      permissions: z.array(PermissionSchema).optional(),
      expiresInMs: DurationMsSchema.optional(),
    }),
  )
  .output(z.object({ issued: IssuedCredentialSchema }));

export const rotate = oc
  .meta(
    route({
      id: "credentials.rotate",
      method: "POST",
      path: "/v1/projects/{projectId}/credentials/{credentialId}/rotate",
      summary: "Rotate an API key with an overlap window",
      description:
        "Creates a replacement and gives the old key a short expiry rather than killing it, so a deploy can roll without dropping events. The window defaults to 24 hours and is clamped to 7 days.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "credentials:write",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(CREDENTIAL_ERRORS)
  .input(
    z.object({
      projectId: ProjectIdSchema,
      credentialId: CredentialIdSchema,
      overlapMs: DurationMsSchema.optional(),
    }),
  )
  .output(z.object({ rotated: RotatedCredentialSchema }));

export const revoke = oc
  .meta(
    route({
      id: "credentials.revoke",
      method: "DELETE",
      path: "/v1/projects/{projectId}/credentials/{credentialId}",
      summary: "Revoke an API key",
      description:
        "Refused with `LastIngestCredential` if it would leave the project unable to receive events. A key inside a rotation's grace window counts as cover, so the leaked half of a rotation can still be killed.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "credentials:write",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(CREDENTIAL_ERRORS)
  .input(z.object({ projectId: ProjectIdSchema, credentialId: CredentialIdSchema }))
  .output(z.object({ revoked: z.literal(true), credential: CredentialIdSchema }));

export const self = oc
  .meta(
    route({
      id: "credentials.self",
      method: "GET",
      path: "/v1/me/credential",
      summary: "Describe the calling credential",
      description:
        "Reachable by any live key, including an ingest key, which holds no permission that would let it read anything else. This is how a freshly provisioned agent discovers its project id.",
      tags: TAGS,
      authorize: { kind: "credential" },
    }),
  )
  .errors(AUTH_ERRORS)
  .input(z.object({}))
  .output(z.object({ credential: CredentialIdentitySchema }));

/**
 * The workspace-wide service key, and why it is a separate route rather than a
 * nullable `projectId`.
 *
 * Every key `credentials.issue` mints is bound to one project, and Q2 refuses a
 * project-bound principal any resource placed at the workspace — deliberately,
 * because reading "no project" as "no restriction" is the v2 escalation. The
 * consequence nobody had followed through: **claiming is authorized on the
 * destination workspace**, so no key issued by any route could ever claim a
 * project. An agent could provision one and had no way to keep it, which is the
 * asymmetry "API-first" was supposed to remove.
 *
 * There is no `kind` in the body. A workspace-wide *ingest* key is inert by
 * construction — an ingest principal with no project reaches nothing (see
 * `fromVerified` in `apps/api/src/auth/principal.ts`) — so the only kind this
 * route could usefully mint is `service`, and accepting a field whose other
 * value is meaningless invites a 400 nobody can act on.
 */
export const issueForWorkspace = oc
  .meta(
    route({
      id: "credentials.issueForWorkspace",
      method: "POST",
      path: "/v1/workspaces/{workspaceId}/credentials",
      summary: "Issue a workspace-wide service key",
      description:
        "A service key that reaches every project in the workspace, and the workspace itself — which is what a key needs in order to claim a provisioned project. Ingest keys are always project-bound and cannot be issued here. The secret is in the response and nowhere else.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "credentials:write",
        resource: "workspace",
        param: "workspaceId",
      },
      successStatus: 201,
    }),
  )
  .errors(CREDENTIAL_ERRORS)
  .input(
    z.object({
      workspaceId: WorkspaceIdSchema,
      name: z.string().min(1).max(200),
      /**
       * A ceiling the caller may ask for, not a grant. The issued set is the
       * intersection with what the issuer holds, and asking for more is
       * refused rather than quietly trimmed.
       */
      permissions: z.array(PermissionSchema).optional(),
      expiresInMs: DurationMsSchema.optional(),
    }),
  )
  .output(z.object({ issued: IssuedCredentialSchema }));

/**
 * Every key in the workspace, its projects' included.
 *
 * The asymmetry with `credentials.list` is the listing half of the binding
 * rule and it runs one way only: a workspace scope sees its projects' keys, a
 * project scope does not see the workspace's. A project-bound principal must
 * not be able to discover that a workspace-wide key exists — which is also why
 * this route needs `credentials:read` **on the workspace**, and a
 * project-bound key is refused it by Q2 rather than by a check written here.
 */
export const listForWorkspace = oc
  .meta(
    route({
      id: "credentials.listForWorkspace",
      method: "GET",
      path: "/v1/workspaces/{workspaceId}/credentials",
      summary: "List every API key in a workspace",
      description:
        "Includes each project's keys and the workspace-wide ones, revoked keys among them: an audit needs them. A project-scoped listing deliberately does not work the other way round.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "credentials:read",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(CREDENTIAL_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema }))
  .output(z.object({ items: z.array(CredentialSchema) }));
