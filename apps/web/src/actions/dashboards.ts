"use server";

/** Dashboard writes. Sharing lives in `share.ts` — its success has a secret. */

import { attempt } from "../lib/client";
import type { Failure } from "../lib/failure";
import { clientForCaller } from "../lib/session";
import { finish, finishAt, finishCreation } from "../lib/act";
import { returnTo, text } from "../lib/form";

export const createDashboard = async (
  form: FormData,
): Promise<Failure | null> => {
  const workspaceId = text(form, "workspaceId");
  const client = await clientForCaller();
  return finishCreation(
    returnTo(form, `/w/${workspaceId}/dashboards`),
    await attempt(
      client.dashboards.create({ workspaceId, name: text(form, "name") }),
    ),
  );
};

export const renameDashboard = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish(
    returnTo(form, "/"),
    await attempt(
      client.dashboards.rename({
        dashboardId: text(form, "dashboardId"),
        name: text(form, "name"),
      }),
    ),
  );
};

export const deleteDashboard = async (form: FormData): Promise<void> => {
  const workspaceId = text(form, "workspaceId");
  const client = await clientForCaller();
  finishAt(
    returnTo(form, `/w/${workspaceId}/dashboards`),
    `/w/${workspaceId}/dashboards`,
    await attempt(
      client.dashboards.delete({ dashboardId: text(form, "dashboardId") }),
    ),
  );
};

export const setDefaultDashboard = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish(
    returnTo(form, "/"),
    await attempt(
      client.dashboards.setDefault({ dashboardId: text(form, "dashboardId") }),
    ),
  );
};

export const unshareDashboard = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish(
    returnTo(form, "/"),
    await attempt(
      client.dashboards.unshare({ dashboardId: text(form, "dashboardId") }),
    ),
  );
};
