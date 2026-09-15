"use server";

import { attempt } from "../lib/client";
import { clientForCaller } from "../lib/session";

/** Load on opening the picker, with the caller's project permissions. */
export async function projectCatalog(projectId: string) {
  const client = await clientForCaller();
  return attempt(client.queries.schema({ projectId }));
}

/** The same public query used by Insights; no separate ingestion status store. */
export async function projectActivity(projectId: string) {
  const client = await clientForCaller();
  return attempt(
    client.queries.run({
      projectId,
      analysis: {
        shape: "breakdown",
        measure: { kind: "count" },
        window: { kind: "relative", amount: 24, unit: "hour" },
        by: { source: "dimension", key: "event_type" },
        order: "desc",
        limit: 20,
      },
    })
  );
}
