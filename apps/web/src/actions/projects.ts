"use server";

/**
 * Project writes.
 *
 * `deleteProject` is authorized as `projects:delete`, an owner-only permission
 * and the fifteenth — V3-SPEC §4 left the question open and it is now settled
 * that way, in place of the `projects:write`-plus-a-role-floor arrangement the
 * server had to check twice. The console does not re-check it: the
 * authorization decision runs once, in `apps/api`, and a second copy here would
 * be a second policy that can disagree.
 * What the console does instead is refuse to render the control for a reader
 * whose role cannot use it, which is a *hint*, not enforcement.
 */

import { attempt } from "../lib/client";
import type { Failure } from "../lib/failure";
import { clientForCaller } from "../lib/session";
import { finish, finishAt, finishCreation } from "../lib/act";
import { integer, returnTo, text } from "../lib/form";
import { redirect } from "next/navigation";

export const createProject = async (
  form: FormData,
): Promise<Failure | null> => {
  const workspaceId = text(form, "workspaceId");
  const client = await clientForCaller();
  const outcome = await attempt(client.projects.create({ workspaceId, name: text(form, "name") }));
  const failure = finishCreation(returnTo(form, `/w/${workspaceId}/projects`), outcome);
  if (!outcome.ok) return failure;
  redirect(`/w/${workspaceId}/projects/${outcome.value.project.id}?setup=1`);
};

export const renameProject = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish(
    returnTo(form, "/"),
    await attempt(
      client.projects.rename({
        projectId: text(form, "projectId"),
        name: text(form, "name"),
      }),
    ),
  );
};

export const archiveProject = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish(
    returnTo(form, "/"),
    await attempt(
      client.projects.archive({ projectId: text(form, "projectId") }),
    ),
  );
};

export const restoreProject = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish(
    returnTo(form, "/"),
    await attempt(
      client.projects.restore({ projectId: text(form, "projectId") }),
    ),
  );
};

export const deleteProject = async (form: FormData): Promise<void> => {
  const workspaceId = text(form, "workspaceId");
  const client = await clientForCaller();
  finishAt(
    returnTo(form, `/w/${workspaceId}/projects`),
    `/w/${workspaceId}/projects`,
    await attempt(
      client.projects.delete({ projectId: text(form, "projectId") }),
    ),
  );
};

/**
 * `inherit` and a day count are different statements, not two spellings of one.
 * The first follows the plan when the plan changes; the second is a ceiling the
 * customer chose, still clamped by the plan. An empty day field therefore means
 * `inherit` rather than "zero days".
 */
export const setRetention = async (form: FormData): Promise<void> => {
  const projectId = text(form, "projectId");
  const days = integer(form, "days");
  const kind = text(form, "kind");
  const client = await clientForCaller();

  if (kind === "days" && (days === null || days < 1 || days > 3650)) {
    return finish(returnTo(form, "/"), {
      ok: false,
      failure: {
        code: "BAD_REQUEST",
        status: 400,
        reason: null,
        message: "Retention in days is a whole number between 1 and 3650.",
      },
    });
  }

  finish(
    returnTo(form, "/"),
    await attempt(
      client.projects.setRetention({
        projectId,
        retention:
          kind === "days" && days !== null
            ? { kind: "days", days }
            : { kind: "inherit" },
      }),
    ),
  );
};
