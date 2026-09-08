"use server";

/**
 * Key writes.
 *
 * Issuing and rotating are the two routes in the whole product that return a
 * secret, and they return it once. That is why they do not redirect: a redirect
 * would have to carry the secret in a URL, and a URL ends up in a proxy log, a
 * referrer header and the reader's history. They return their result to a
 * client component instead, which shows it and never sees it again.
 *
 * Revoking has nothing to show, so it redirects like every other write.
 */

import { revalidatePath } from "next/cache";
import { attempt } from "../lib/client";
import type { ContractOutputs } from "../lib/client";
import { clientForCaller } from "../lib/session";
import { finish } from "../lib/act";
import { integer, returnTo, text } from "../lib/form";
import type { Failure } from "../lib/failure";

export type IssueState =
  | { readonly status: "idle" }
  | { readonly status: "issued"; readonly issued: ContractOutputs["credentials"]["issue"]["issued"] }
  | { readonly status: "failed"; readonly failure: Failure };

export type RotateState =
  | { readonly status: "idle" }
  | {
      readonly status: "rotated";
      readonly rotated: ContractOutputs["credentials"]["rotate"]["rotated"];
    }
  | { readonly status: "failed"; readonly failure: Failure };

const path = (form: FormData): string => returnTo(form, "/");

export const issueCredential = async (
  _previous: IssueState,
  form: FormData,
): Promise<IssueState> => {
  const kind = text(form, "kind");
  if (kind !== "ingest" && kind !== "service") {
    return {
      status: "failed",
      failure: { code: "BAD_REQUEST", status: 400, reason: null, message: "Choose a key kind." },
    };
  }

  const expiresInDays = integer(form, "expiresInDays");
  const client = await clientForCaller();
  const outcome = await attempt(
    client.credentials.issue({
      projectId: text(form, "projectId"),
      kind,
      name: text(form, "name"),
      // `permissions` is deliberately not sent. It is a request for a ceiling,
      // not a grant — the issued set is the intersection with what the issuer
      // holds — and the console has no reason to ask for less than that.
      ...(expiresInDays === null || expiresInDays <= 0
        ? {}
        : { expiresInMs: expiresInDays * 86_400_000 }),
    }),
  );

  if (!outcome.ok) return { status: "failed", failure: outcome.failure };
  revalidatePath(path(form).split("?")[0] ?? "/");
  return { status: "issued", issued: outcome.value.issued };
};

/**
 * Rotation is create-new plus expire-old, and the overlap is why: the retiring
 * key stays usable for the window, which is what makes it possible to replace a
 * leaked key without a gap in ingest. A default of a week is a product
 * decision, not a technical one, which is why it is a number here rather than a
 * constant in the domain.
 */
export const rotateCredential = async (
  _previous: RotateState,
  form: FormData,
): Promise<RotateState> => {
  const overlapDays = integer(form, "overlapDays");
  const client = await clientForCaller();
  const outcome = await attempt(
    client.credentials.rotate({
      projectId: text(form, "projectId"),
      credentialId: text(form, "credentialId"),
      overlapMs: (overlapDays === null || overlapDays < 0 ? 7 : overlapDays) * 86_400_000,
    }),
  );

  if (!outcome.ok) return { status: "failed", failure: outcome.failure };
  revalidatePath(path(form).split("?")[0] ?? "/");
  return { status: "rotated", rotated: outcome.value.rotated };
};

export const revokeCredential = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish(
    path(form),
    await attempt(
      client.credentials.revoke({
        projectId: text(form, "projectId"),
        credentialId: text(form, "credentialId"),
      }),
    ),
  );
};
