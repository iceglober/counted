"use server";

import { attempt } from "../lib/client";
import { clientForCaller } from "../lib/session";
import { finishCreation } from "../lib/act";
import { text } from "../lib/form";
import type { ContractInputs } from "../lib/client";

/** The capability is sent only in this request body, never in navigation state. */
export async function claimProject(input: ContractInputs["projects"]["claim"]) {
  return attempt((await clientForCaller()).projects.claim(input));
}
export async function createClaimWorkspace(form: FormData) {
  return finishCreation("/claim", await attempt((await clientForCaller()).workspaces.create({name: text(form, "name")})));
}
