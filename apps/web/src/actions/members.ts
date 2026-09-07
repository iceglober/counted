"use server";

/**
 * The one membership write that is not a contract procedure. See
 * `lib/invitations.ts` for why it cannot be.
 */

import { revalidatePath } from "next/cache";
import type { Failure } from "../lib/failure";
import { inviteMember } from "../lib/invitations";
import { cookieForCaller } from "../lib/session";
import { returnTo, text } from "../lib/form";

export const invite = async (form: FormData): Promise<Failure | null> => {
  const workspaceId = text(form, "workspaceId");
  const back = returnTo(form, `/w/${workspaceId}/members`);
  const role = text(form, "role");

  if (role !== "owner" && role !== "admin" && role !== "member") {
    return {
      code: "BAD_REQUEST",
      status: 400,
      reason: null,
      message: "Unknown role.",
    };
  }

  const outcome = await inviteMember({
    workspaceId,
    email: text(form, "email"),
    role,
    cookie: await cookieForCaller(),
  });

  if (outcome.kind === "failed") return outcome.failure;
  if (outcome.kind === "unavailable") {
    return {
      code: "NOT_IMPLEMENTED",
      status: 501,
      reason: null,
      message: "Invitations are not enabled on this deployment.",
    };
  }

  revalidatePath(back.split("?")[0] ?? "/");
  return null;
};
