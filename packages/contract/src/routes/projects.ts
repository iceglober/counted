/**
 * Projects, including the two routes that make the no-signup path complete.
 *
 * `projects.provision` takes no credential and returns a project, an ingest key
 * and a claim grant. `projects.claim` takes that grant and an API key. Together
 * they are the path v2 did not have: v2 could provision without a browser but
 * claiming required a console session, so an agent could create a project and
 * then had no way to keep it. The project would sit unclaimed until it expired,
 * with the events already in it.
 *
 * `projects.delete` is authorized as `projects:delete`, the fifteenth
 * permission and an owner-only one. V3-SPEC §4 left this open and answered it
 * provisionally with `projects:write` plus an owner-role floor checked at the
 * procedure — a second condition `decide` could not express, so the server ran
 * two checks by hand and nothing compared them. Deletion is its own authority,
 * so it is its own permission, and one call decides it.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";
import { route } from "../route";
import { CLAIM_ERRORS, PROJECT_ERRORS, PROVISION_ERRORS } from "../errors";
import { ProjectIdSchema, WorkspaceIdSchema } from "../primitives";
import { IssuedCredentialSchema } from "../schemas/identity";
import {
  ClaimGrantSchema,
  ProjectSchema,
  ProjectSummarySchema,
  RetentionPolicySchema,
} from "../schemas/project";

const TAGS = ["projects"] as const;

const NameSchema = z.string().min(1).max(200);

export const list = oc
  .meta(
    route({
      id: "projects.list",
      method: "GET",
      path: "/v1/workspaces/{workspaceId}/projects",
      summary: "List a workspace's projects",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "projects:read",
        resource: "workspace",
        param: "workspaceId",
      },
      query: { includeArchived: "primitive" },
    }),
  )
  .errors(PROJECT_ERRORS)
  .input(
    z.object({
      workspaceId: WorkspaceIdSchema,
      includeArchived: z
        .stringbool()
        .optional()
        .describe("Query parameters arrive as strings; `true` and `1` both mean yes."),
    }),
  )
  .output(z.object({ items: z.array(ProjectSummarySchema) }));

export const create = oc
  .meta(
    route({
      id: "projects.create",
      method: "POST",
      path: "/v1/workspaces/{workspaceId}/projects",
      summary: "Create a project",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "projects:write",
        resource: "workspace",
        param: "workspaceId",
      },
      successStatus: 201,
    }),
  )
  .errors(PROJECT_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema, name: NameSchema }))
  .output(z.object({ project: ProjectSchema }));

export const get = oc
  .meta(
    route({
      id: "projects.get",
      method: "GET",
      path: "/v1/projects/{projectId}",
      summary: "Read a project",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "projects:read",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(PROJECT_ERRORS)
  .input(z.object({ projectId: ProjectIdSchema }))
  .output(z.object({ project: ProjectSchema }));

export const rename = oc
  .meta(
    route({
      id: "projects.rename",
      method: "PATCH",
      path: "/v1/projects/{projectId}",
      summary: "Rename a project",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "projects:write",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(PROJECT_ERRORS)
  .input(z.object({ projectId: ProjectIdSchema, name: NameSchema }))
  .output(z.object({ project: ProjectSchema }));

export const archive = oc
  .meta(
    route({
      id: "projects.archive",
      method: "POST",
      path: "/v1/projects/{projectId}/archive",
      summary: "Archive a project",
      description:
        "Archiving stops ingest and frees the project's slot against the plan's cap. Events are kept until retention expires them.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "projects:write",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(PROJECT_ERRORS)
  .input(z.object({ projectId: ProjectIdSchema }))
  .output(z.object({ project: ProjectSchema }));

export const restore = oc
  .meta(
    route({
      id: "projects.restore",
      method: "POST",
      path: "/v1/projects/{projectId}/restore",
      summary: "Restore an archived project",
      description:
        "Re-checks the plan's project cap: archive-then-restore would otherwise be a way past it.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "projects:write",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(PROJECT_ERRORS)
  .input(z.object({ projectId: ProjectIdSchema }))
  .output(z.object({ project: ProjectSchema }));

export const setRetention = oc
  .meta(
    route({
      id: "projects.setRetention",
      method: "PUT",
      path: "/v1/projects/{projectId}/retention",
      summary: "Set how long this project's events are kept",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "projects:write",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(PROJECT_ERRORS)
  .input(z.object({ projectId: ProjectIdSchema, retention: RetentionPolicySchema }))
  .output(z.object({ project: ProjectSchema }));

export const remove = oc
  .meta(
    route({
      id: "projects.delete",
      method: "DELETE",
      path: "/v1/projects/{projectId}",
      summary: "Delete a project and its events",
      description:
        "Irreversible, and owner-only: `projects:delete` is a separate permission from `projects:write`, because deletion and renaming are not the same authority.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "projects:delete",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(PROJECT_ERRORS)
  .input(z.object({ projectId: ProjectIdSchema }))
  .output(z.object({ deleted: z.literal(true), project: ProjectIdSchema }));

export const provision = oc
  .meta(
    route({
      id: "projects.provision",
      method: "POST",
      path: "/v1/projects/provision",
      summary: "Provision an unclaimed project",
      description:
        "Takes no credential. Returns a project with no workspace, an ingest key that works immediately, and a claim grant. This is the whole of the no-signup path; send events first and decide about an account later.",
      tags: TAGS,
      authorize: { kind: "anonymous" },
      successStatus: 201,
    }),
  )
  .errors(PROVISION_ERRORS)
  .input(z.object({ name: NameSchema.optional() }))
  .output(
    z.object({
      project: ProjectSchema,
      credential: IssuedCredentialSchema,
      claim: ClaimGrantSchema,
    }),
  );

export const claim = oc
  .meta(
    route({
      id: "projects.claim",
      method: "POST",
      path: "/v1/projects/{projectId}/claim",
      summary: "Claim a provisioned project into a workspace",
      description:
        "Callable with a service key, which is what closes the agent path. The authorization is on the destination workspace: the claim grant proves the caller provisioned the project, and `projects:write` proves they may put a project in that workspace.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "projects:write",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(CLAIM_ERRORS)
  .input(
    z.object({
      projectId: ProjectIdSchema,
      workspaceId: WorkspaceIdSchema,
      claimToken: z.string().min(1),
    }),
  )
  .output(z.object({ project: ProjectSchema }));
