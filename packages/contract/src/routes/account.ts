/**
 * The caller's own account.
 *
 * One route, and it answers the question every console asks first: who am I and
 * what can I see. Returning the workspace list with the account saves a second
 * round trip on every page load, and the two facts are never useful apart.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";
import { route } from "../route";
import { ACCOUNT_ERRORS } from "../errors";
import { AccountSchema } from "../schemas/identity";
import { WorkspaceSummarySchema } from "../schemas/tenancy";

export const me = oc
  .meta(
    route({
      id: "account.me",
      method: "GET",
      path: "/v1/me",
      summary: "Read the calling account",
      description:
        "A service key answers as the account that issued it, which is what makes an audit trail possible without a session.",
      tags: ["account"],
      authorize: { kind: "account" },
    }),
  )
  .errors(ACCOUNT_ERRORS)
  .input(z.object({}))
  .output(
    z.object({
      account: AccountSchema,
      workspaces: z.array(WorkspaceSummarySchema),
    }),
  );
