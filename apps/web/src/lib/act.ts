/**
 * Mutations revalidate their originating page. Existing edit/delete forms
 * redirect with safe error parameters; creation dialogs return failures so
 * entered values survive a refused save. One-time secrets remain in React state.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Attempt } from "./client";
import type { Failure } from "./failure";
import { withFailure, withoutFailure } from "./form";

/** `revalidatePath` takes a path; a query string makes it match nothing. */
const pathOnly = (path: string): string => path.split("?")[0] ?? "/";

/** Creation dialogs retain their draft on failure and close only after a saved write. */
export const finishCreation = (
  path: string,
  outcome: Attempt<unknown>,
): Failure | null => {
  if (!outcome.ok) return outcome.failure;
  revalidatePath(pathOnly(path));
  return null;
};

export const finish = (path: string, outcome: Attempt<unknown>): never => {
  if (!outcome.ok) redirect(withFailure(path, outcome.failure));
  revalidatePath(pathOnly(path));
  redirect(withoutFailure(path));
};

/** Same, but the reader lands somewhere else — a delete leaving a detail page. */
export const finishAt = (
  from: string,
  to: string,
  outcome: Attempt<unknown>,
): never => {
  if (!outcome.ok) redirect(withFailure(from, outcome.failure));
  revalidatePath(pathOnly(from));
  revalidatePath(pathOnly(to));
  redirect(to);
};
