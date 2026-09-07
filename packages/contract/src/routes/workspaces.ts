/**
 * Workspaces: the billing and membership boundary.
 *
 * `workspaces.list` is new in v3. v2 had no way for an API key to ask which
 * workspace it belonged to, so every SDK sample began with a workspace id
 * pasted from the console — which is also why v2's agent flow could not
 * complete without a browser.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";
import { route } from "../route";
import { AUTH_ERRORS, WORKSPACE_ERRORS } from "../errors";
import { AccountIdSchema, RoleSchema, WorkspaceIdSchema } from "../primitives";
import { MemberSchema } from "../schemas/identity";
import {
  UsageSchema,
  WorkspaceSchema,
  WorkspaceSummarySchema,
} from "../schemas/tenancy";

const TAGS = ["workspaces"] as const;

export const list = oc
  .meta(
    route({
      id: "workspaces.list",
      method: "GET",
      path: "/v1/workspaces",
      summary: "List the workspaces this credential reaches",
      description:
        "A console session lists every workspace the account belongs to. A service key lists the one workspace it was issued in.",
      tags: TAGS,
      authorize: { kind: "principal", permission: "workspace:read" },
    }),
  )
  .errors(AUTH_ERRORS)
  .input(z.object({}))
  .output(z.object({ items: z.array(WorkspaceSummarySchema) }));

export const create = oc
  .meta(
    route({
      id: "workspaces.create",
      method: "POST",
      path: "/v1/workspaces",
      summary: "Create a workspace",
      description:
        "Requires an authenticated account and no permission: there is no workspace yet to hold one in.",
      tags: TAGS,
      authorize: { kind: "account" },
      successStatus: 201,
    }),
  )
  .errors(WORKSPACE_ERRORS)
  .input(z.object({ name: z.string().min(1).max(200) }))
  .output(z.object({ workspace: WorkspaceSchema }));

export const get = oc
  .meta(
    route({
      id: "workspaces.get",
      method: "GET",
      path: "/v1/workspaces/{workspaceId}",
      summary: "Read a workspace",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "workspace:read",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(WORKSPACE_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema }))
  .output(z.object({ workspace: WorkspaceSchema }));

export const rename = oc
  .meta(
    route({
      id: "workspaces.rename",
      method: "PATCH",
      path: "/v1/workspaces/{workspaceId}",
      summary: "Rename a workspace",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "workspace:admin",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(WORKSPACE_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema, name: z.string().min(1).max(200) }))
  .output(z.object({ workspace: WorkspaceSchema }));

export const members = oc
  .meta(
    route({
      id: "workspaces.members",
      method: "GET",
      path: "/v1/workspaces/{workspaceId}/members",
      summary: "List workspace members",
      description:
        "Read-only. Membership is written through the auth provider's own endpoints, not here — one table, one writer.",
      tags: ["members"],
      authorize: {
        kind: "resource",
        permission: "workspace:read",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(WORKSPACE_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema }))
  .output(z.object({ items: z.array(MemberSchema) }));

export const usage = oc
  .meta(
    route({
      id: "workspaces.usage",
      method: "GET",
      path: "/v1/workspaces/{workspaceId}/usage",
      summary: "Read this period's usage against the plan",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "workspace:read",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(WORKSPACE_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema }))
  .output(z.object({ usage: UsageSchema }));

export const changeRole = oc
  .meta(
    route({
      id: "workspaces.changeRole",
      method: "PUT",
      path: "/v1/workspaces/{workspaceId}/members/{accountId}/role",
      summary: "Change a member's role",
      description:
        "The last owner cannot be demoted; the refusal is `LastOwner`, not a 500 from a foreign key.",
      tags: ["members"],
      authorize: {
        kind: "resource",
        permission: "workspace:admin",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(WORKSPACE_ERRORS)
  .input(
    z.object({
      workspaceId: WorkspaceIdSchema,
      accountId: AccountIdSchema,
      role: RoleSchema,
    }),
  )
  .output(z.object({ member: MemberSchema }));

export const removeMember = oc
  .meta(
    route({
      id: "workspaces.removeMember",
      method: "DELETE",
      path: "/v1/workspaces/{workspaceId}/members/{accountId}",
      summary: "Remove a member",
      tags: ["members"],
      authorize: {
        kind: "resource",
        permission: "workspace:admin",
        resource: "workspace",
        param: "workspaceId",
      },
    }),
  )
  .errors(WORKSPACE_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema, accountId: AccountIdSchema }))
  .output(z.object({ removed: z.literal(true), account: AccountIdSchema }));

export const leave = oc
  .meta(route({
    id: "workspaces.leave", method: "POST", path: "/v1/workspaces/{workspaceId}/leave",
    summary: "Leave a workspace", description: "Removes only the calling account. A workspace's last owner must transfer ownership first.", tags: ["members"],
    authorize: { kind: "resource", permission: "workspace:read", resource: "workspace", param: "workspaceId" },
  }))
  .errors(WORKSPACE_ERRORS)
  .input(z.object({ workspaceId: WorkspaceIdSchema }))
  .output(z.object({ left: z.literal(true) }));
