/**
 * Public share links.
 *
 * A wrong token and an unshared dashboard both answer `NotShared`, with no 401
 * and no 403 anywhere on these two routes. A distinct status would turn the
 * endpoint into an oracle for which dashboards have live links — ask for a
 * dashboard id with a junk token and the difference between 403 and 404 tells
 * you whether that dashboard is shared. A right-but-expired token is told
 * `ShareGrantExpired`, which only tells someone who already had the token.
 *
 * The authorization middleware has already resolved the token into a `share`
 * principal bound to one dashboard by *identity*, so the handler does not
 * re-check reach: a token for one dashboard cannot read a sibling even in a
 * project the link is allowed to query.
 */

import { Duration } from "@counted/kernel";
import { resolveShare } from "@counted/dashboarding-app";
import { toWindow } from "../analysis/wire";
import { fromDashboardError, raise } from "../faults";
import * as serialize from "../serialize";
import { dashboardDeps } from "../wiring";
import type { HandlerDeps } from "./deps";
import { runDashboard } from "./readouts";
import { orAnalysisFault } from "./support";

export const shareRoutes = ({ deps, guarded }: HandlerDeps) => {
  const opened = async (token: string) => {
    const resolved = await resolveShare(dashboardDeps(deps, deps.reads), token);
    if (!resolved.ok) raise(fromDashboardError(resolved.error));
    return resolved.value;
  };

  return {
    view: guarded.share.view.handler(async ({ input }) => ({
      dashboard: serialize.dashboard(await opened(input.shareToken)),
    })),

    readouts: guarded.share.readouts.handler(async ({ input, context }) => {
      const dashboard = await opened(input.shareToken);
      const window =
        input.window === undefined ? null : orAnalysisFault(toWindow(input.window));

      return {
        readouts: await runDashboard(deps, {
          dashboard,
          window,
          deadline:
            input.deadlineMs === undefined
              ? deps.config.queryDeadline
              : Duration.millis(input.deadlineMs),
          now: context.at,
          traceId: context.traceId,
        }),
      };
    }),
  };
};
