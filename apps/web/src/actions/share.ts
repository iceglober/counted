"use server";

/**
 * Creating a share link.
 *
 * The token exists once, at creation — Counted stores only its digest — so this
 * returns it to a client component rather than redirecting. Afterwards the
 * console can say a link is live and when it lapses, and cannot recover the
 * URL: revoking and re-sharing is the only way to get one back, and the page
 * says so.
 */

import { revalidatePath } from "next/cache";
import { attempt } from "../lib/client";
import type { ContractOutputs } from "../lib/client";
import { clientForCaller } from "../lib/session";
import { integer, returnTo, text } from "../lib/form";
import type { Failure } from "../lib/failure";

export type SharingOutcome =
  | { readonly status: "idle" }
  | { readonly status: "shared"; readonly link: ContractOutputs["dashboards"]["share"]["link"] }
  | { readonly status: "failed"; readonly failure: Failure };

export const shareDashboard = async (
  _previous: SharingOutcome,
  form: FormData,
): Promise<SharingOutcome> => {
  const days = integer(form, "expiresInDays");
  const client = await clientForCaller();
  const outcome = await attempt(
    client.dashboards.share({
      dashboardId: text(form, "dashboardId"),
      ...(days === null || days <= 0 ? {} : { expiresInMs: days * 86_400_000 }),
    }),
  );

  if (!outcome.ok) return { status: "failed", failure: outcome.failure };
  revalidatePath(returnTo(form, "/").split("?")[0] ?? "/");
  return { status: "shared", link: outcome.value.link };
};
