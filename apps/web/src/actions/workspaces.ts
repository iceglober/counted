"use server";

/**
 * Workspace and membership writes.
 *
 * Membership changes go through the API's contract routes rather than through
 * better-auth directly, even though better-auth owns the `member` table: the
 * rules that make `changeRole` refusable — you cannot demote the last owner,
 * you cannot set the role someone already holds — live in the domain, and a
 * console that called the provider's endpoint would route around them.
 */

import { redirect } from "next/navigation";
import { attempt } from "../lib/client";
import { clientForCaller } from "../lib/session";
import { finish } from "../lib/act";
import { returnTo, text } from "../lib/form";

export const createWorkspace = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  const outcome = await attempt(client.workspaces.create({ name: text(form, "name") }));
  if (!outcome.ok) return finish(returnTo(form, "/welcome"), outcome);
  redirect(`/w/${outcome.value.workspace.id}/dashboards`);
};

export const renameWorkspace = async (form: FormData): Promise<void> => {
  const workspaceId = text(form, "workspaceId");
  const client = await clientForCaller();
  finish(
    returnTo(form, `/w/${workspaceId}/settings`),
    await attempt(client.workspaces.rename({ workspaceId, name: text(form, "name") })),
  );
};

export const changeRole = async (form: FormData): Promise<void> => {
  const workspaceId = text(form, "workspaceId");
  const role = text(form, "role");
  // The wire type is a closed enum. Narrowing here rather than casting means a
  // hand-edited form value is refused by this console instead of producing a
  // 422 the reader cannot act on.
  if (role !== "owner" && role !== "admin" && role !== "member") {
    return finish(returnTo(form, `/w/${workspaceId}/members`), {
      ok: false,
      failure: { code: "BAD_REQUEST", status: 400, reason: null, message: "Unknown role." },
    });
  }
  const client = await clientForCaller();
  finish(
    returnTo(form, `/w/${workspaceId}/members`),
    await attempt(
      client.workspaces.changeRole({
        workspaceId,
        accountId: text(form, "accountId"),
        role,
      }),
    ),
  );
};

export const removeMember = async (form: FormData): Promise<void> => {
  const workspaceId = text(form, "workspaceId");
  const client = await clientForCaller();
  finish(
    returnTo(form, `/w/${workspaceId}/members`),
    await attempt(
      client.workspaces.removeMember({ workspaceId, accountId: text(form, "accountId") }),
    ),
  );
};

export const leaveWorkspace = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish("/account", await attempt(client.workspaces.leave({ workspaceId: text(form, "workspaceId") })));
};
