/**
 * The router: every procedure the contract describes, implemented.
 *
 * **Assembled with the plain implementer, built from the guarded one.** That
 * distinction is the whole of `base.ts`: `guarded.router({ … })` would apply
 * the authorization middleware a second time, so every request would resolve
 * its principal twice and run its membership lookups twice. `base.test.ts`
 * counts the calls, because nothing in the shape of the code says which of the
 * two arrangements you have written.
 *
 * The census test asserts this tree and `@counted/contract` name exactly the
 * same procedures, in both directions.
 */

import type { ApiDependencies } from "../deps";
import { createBase } from "./base";
import type { AuthorizeDeps } from "../auth/authorize";
import { accountRoutes } from "./account";
import { billingRoutes } from "./billing";
import { credentialRoutes } from "./credentials";
import { dashboardRoutes } from "./dashboards";
import { monitorRoutes } from "./monitors";
import { projectRoutes } from "./projects";
import { queryRoutes } from "./queries";
import { shareRoutes } from "./share";
import { tileRoutes } from "./tiles";
import { workspaceRoutes } from "./workspaces";

export const createRouter = (deps: ApiDependencies, authorize: AuthorizeDeps) => {
  const { os, guarded } = createBase(authorize);
  const handlers = { deps, guarded };

  return os.router({
    account: accountRoutes(handlers),
    workspaces: workspaceRoutes(handlers),
    projects: projectRoutes(handlers),
    credentials: credentialRoutes(handlers),
    dashboards: dashboardRoutes(handlers),
    tiles: tileRoutes(handlers),
    monitors: monitorRoutes(handlers),
    billing: billingRoutes(handlers),
    queries: queryRoutes(handlers),
    share: shareRoutes(handlers),
  });
};

export type ApiRouter = ReturnType<typeof createRouter>;
