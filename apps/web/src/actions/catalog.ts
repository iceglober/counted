"use server";

import { attempt } from "../lib/client";
import { clientForCaller } from "../lib/session";

/** Load on opening the picker, with the caller's project permissions. */
export async function projectCatalog(projectId: string) {
  const client = await clientForCaller();
  return attempt(client.queries.schema({ projectId }));
}
