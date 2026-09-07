"use server";

/**
 * Monitor writes.
 *
 * `monitors.update` is one route, posted from three forms that stay apart on
 * purpose. Changing the threshold retargets the monitor and clears its breach
 * state; changing the cooldown or the channels does not; renaming changes
 * nothing about what is watched. One form that posted every field would
 * retarget on each save, and muting a channel would then re-announce a breach
 * that was already reported — the v1 behaviour the route's own description
 * rules out.
 *
 * The form's own combinations are refused here, before the API sees them, as
 * `addInsight` does: the problem is with the fields the reader filled in, and a
 * 422 about an `Analysis` they never saw is not an instruction.
 */

import type { Attempt } from "../lib/client";
import { attempt } from "../lib/client";
import type { Failure } from "../lib/failure";
import { clientForCaller } from "../lib/session";
import { finish, finishAt, finishCreation } from "../lib/act";
import { compose, delivery, retargetAnalysis, threshold } from "../lib/monitors";
import { decimal, integer, optional, returnTo, text } from "../lib/form";

/** A refusal of the form's own making, shaped like the API's so the page renders it alike. */
const invalid = (problem: string): Attempt<never> => ({
  ok: false,
  failure: { code: "BAD_REQUEST", status: 400, reason: null, message: problem },
});

export const createMonitor = async (
  form: FormData,
): Promise<Failure | null> => {
  const workspaceId = text(form, "workspaceId");
  const back = returnTo(form, `/w/${workspaceId}/monitors`);

  const composed = compose({
    measure: text(form, "measure"),
    event: optional(form, "event"),
    ...(form.has("events") ? { events: form.getAll("events").map(String).filter(Boolean) } : {}),
    windowAmount: integer(form, "windowAmount"),
    windowUnit: text(form, "windowUnit"),
    summary: text(form, "summary"),
    comparison: text(form, "comparison"),
    value: decimal(form, "value"),
    cooldownAmount: decimal(form, "cooldownAmount"),
    cooldownUnit: text(form, "cooldownUnit"),
    channels: text(form, "channels"),
  });
  if (!composed.ok) return finishCreation(back, invalid(composed.problem));

  const client = await clientForCaller();
  return finishCreation(
    back,
    await attempt(
      client.monitors.create({
        projectId: text(form, "projectId"),
        name: text(form, "name"),
        ...composed.value,
      }),
    ),
  );
};

export const renameMonitor = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish(
    returnTo(form, "/"),
    await attempt(
      client.monitors.update({
        monitorId: text(form, "monitorId"),
        name: text(form, "name"),
      }),
    ),
  );
};

/** Retargets: the breach state resets, and a crossed threshold fires afresh. */
export const setMonitorThreshold = async (form: FormData): Promise<void> => {
  const back = returnTo(form, "/");
  const limit = threshold(text(form, "comparison"), decimal(form, "value"));
  if (!limit.ok) return finish(back, invalid(limit.problem));

  const client = await clientForCaller();
  finish(
    back,
    await attempt(
      client.monitors.update({
        monitorId: text(form, "monitorId"),
        threshold: limit.value,
      }),
    ),
  );
};

/** Retarget only the measurement; delivery configuration remains independent. */
export const setMonitorAnalysis = async (form: FormData): Promise<void> => {
  const back = returnTo(form, "/");
  const client = await clientForCaller();
  const current = await attempt(client.monitors.get({ monitorId: text(form, "monitorId") }));
  if (!current.ok) return finish(back, current);
  const changed = retargetAnalysis(current.value.monitor.analysis, {
    measure: text(form, "measure"), event: undefined,
    events: form.getAll("events").map(String).filter(Boolean),
    windowAmount: integer(form, "windowAmount"), windowUnit: text(form, "windowUnit"), summary: text(form, "summary"),
  });
  if (!changed.ok) return finish(back, invalid(changed.problem));
  finish(back, await attempt(client.monitors.update({ monitorId: text(form, "monitorId"), analysis: changed.value })));
};

/** Reconfigures: channels and cooldown change, breach state survives. */
export const setMonitorDelivery = async (form: FormData): Promise<void> => {
  const back = returnTo(form, "/");
  const announce = delivery({
    cooldownAmount: decimal(form, "cooldownAmount"),
    cooldownUnit: text(form, "cooldownUnit"),
    channels: text(form, "channels"),
  });
  if (!announce.ok) return finish(back, invalid(announce.problem));

  const client = await clientForCaller();
  finish(
    back,
    await attempt(
      client.monitors.update({
        monitorId: text(form, "monitorId"),
        ...announce.value,
      }),
    ),
  );
};

export const enableMonitor = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish(
    returnTo(form, "/"),
    await attempt(
      client.monitors.enable({ monitorId: text(form, "monitorId") }),
    ),
  );
};

export const disableMonitor = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish(
    returnTo(form, "/"),
    await attempt(
      client.monitors.disable({ monitorId: text(form, "monitorId") }),
    ),
  );
};

export const deleteMonitor = async (form: FormData): Promise<void> => {
  const workspaceId = text(form, "workspaceId");
  const list = `/w/${workspaceId}/monitors`;
  const client = await clientForCaller();
  finishAt(
    returnTo(form, list),
    list,
    await attempt(
      client.monitors.delete({ monitorId: text(form, "monitorId") }),
    ),
  );
};
