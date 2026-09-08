/**
 * Public share links.
 *
 * The token travels as a query parameter, `shareToken`, which is both what the
 * `shareToken` security scheme documents and what the URL a person pastes into
 * Slack actually contains. An `apiKey` scheme in OpenAPI may live in a query,
 * a header or a cookie — never a path — so putting the token in the path would
 * have meant declaring these two routes unauthenticated, which is the lie v2's
 * document told.
 *
 * A wrong token and an unshared dashboard both answer `NotShared`, and there is
 * deliberately no 401 or 403 here. A distinct status would turn the endpoint
 * into an oracle for which dashboards have live links. A right-but-expired
 * token is told `ShareGrantExpired`, which only tells someone who already had
 * the token.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";
import { route } from "../route";
import { SHARE_ERRORS } from "../errors";
import { DurationMsSchema } from "../primitives";
import { DashboardSchema } from "../schemas/dashboarding";
import { WindowSchema } from "../schemas/analysis";
import { ReadoutSchema } from "../schemas/readout";

const TAGS = ["share"] as const;

const ShareTokenSchema = z.string().min(1).describe("The token from the share URL.");

export const view = oc
  .meta(
    route({
      id: "share.view",
      method: "GET",
      path: "/v1/shared/dashboard",
      summary: "Read a shared dashboard",
      description:
        "The link reaches exactly the dashboard it was minted for, by identity. A token for one dashboard cannot read a sibling, even one in a project the link is allowed to query.",
      tags: TAGS,
      authorize: { kind: "share" },
      query: { shareToken: "primitive" },
    }),
  )
  .errors(SHARE_ERRORS)
  .input(z.object({ shareToken: ShareTokenSchema }))
  .output(z.object({ dashboard: DashboardSchema }));

export const readouts = oc
  .meta(
    route({
      id: "share.readouts",
      method: "GET",
      path: "/v1/shared/readouts",
      summary: "Run every insight on a shared dashboard",
      description:
        "One outcome per insight, exactly as the authenticated route does. A share link may run the queries the page it shows needs, and no others.",
      tags: TAGS,
      authorize: { kind: "share" },
      query: { shareToken: "primitive", window: "json", deadlineMs: "primitive" },
    }),
  )
  .errors(SHARE_ERRORS)
  .input(
    z.object({
      shareToken: ShareTokenSchema,
      window: WindowSchema.optional(),
      deadlineMs: DurationMsSchema.optional(),
    }),
  )
  .output(z.object({ readouts: z.array(ReadoutSchema) }));
