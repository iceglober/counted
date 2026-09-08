/**
 * @counted/contract — one description of every route, four consumers.
 *
 *                    packages/contract  (oRPC v2, Zod 4)
 *                              |
 *        +----------+----------+----------+--------------+
 *        v          v                     v              v
 *   OpenAPIHandler  OpenAPIGenerator   MCP tools    RouterContractClient
 *   (HTTP routes)   (openapi.json)     (apps/mcp)   (console + SDKs)
 *
 * Three things this package gets right by construction rather than by care:
 *
 *   `oc` has five methods — meta, errors, input, output, router. Routing
 *   metadata comes from the `openapi()` helper, path params are `{braces}`, and
 *   every `{param}` is a required field of the input schema. A test walks the
 *   generated document and asserts the last part, because oRPC hard-errors on
 *   it at generation time and a hard error at build time is worse than a test.
 *
 *   Typed errors use oRPC's closed 22-code vocabulary. The domain error's name
 *   travels in `data.reason`; the code carries only the status. `errors.ts` is
 *   V3-SPEC §6's table written as data, and a test asserts no code outside the
 *   vocabulary reached the document.
 *
 *   Security is emitted from the authorization declaration, once. See
 *   `authorization.ts` — this is the property v2 did not have.
 *
 * Three routes keep dedicated transports in apps/api: event ingestion (group
 * commit), the auth provider's routes, and the signed Stripe webhook. Ingestion
 * shares schemas here and is merged into the generated document; auth and
 * provider webhook implementation details stay outside the public reference.
 */

import type {
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from "@orpc/contract";
import * as account from "./routes/account";
import * as billing from "./routes/billing";
import * as credentials from "./routes/credentials";
import * as dashboards from "./routes/dashboards";
import * as monitors from "./routes/monitors";
import * as projects from "./routes/projects";
import * as queries from "./routes/queries";
import * as share from "./routes/share";
import * as tiles from "./routes/tiles";
import * as workspaces from "./routes/workspaces";

/**
 * The contract root.
 *
 * The key path of a procedure is its operation id — `dashboards.list`,
 * `tiles.add` — and that is also the key of its authorization requirement. A
 * test asserts all three agree for every procedure, which is what lets
 * `requirementFor(path)` in `apps/api` be a lookup rather than a second table.
 */
export const contract = {
  account: {
    me: account.me,
  },
  workspaces: {
    list: workspaces.list,
    create: workspaces.create,
    get: workspaces.get,
    rename: workspaces.rename,
    members: workspaces.members,
    usage: workspaces.usage,
    changeRole: workspaces.changeRole,
    removeMember: workspaces.removeMember,
    leave: workspaces.leave,
  },
  projects: {
    list: projects.list,
    create: projects.create,
    get: projects.get,
    rename: projects.rename,
    archive: projects.archive,
    restore: projects.restore,
    setRetention: projects.setRetention,
    delete: projects.remove,
    provision: projects.provision,
    claim: projects.claim,
  },
  credentials: {
    list: credentials.list,
    issue: credentials.issue,
    rotate: credentials.rotate,
    revoke: credentials.revoke,
    self: credentials.self,
    issueForWorkspace: credentials.issueForWorkspace,
    listForWorkspace: credentials.listForWorkspace,
  },
  dashboards: {
    list: dashboards.list,
    create: dashboards.create,
    get: dashboards.get,
    rename: dashboards.rename,
    layout: dashboards.layout,
    delete: dashboards.remove,
    setDefault: dashboards.setDefault,
    readouts: dashboards.readouts,
    share: dashboards.share,
    unshare: dashboards.unshare,
  },
  tiles: {
    get: tiles.get,
    add: tiles.add,
    update: tiles.update,
    resize: tiles.resize,
    move: tiles.move,
    reorder: tiles.reorder,
    remove: tiles.remove,
  },
  monitors: {
    list: monitors.list,
    listForProject: monitors.listForProject,
    create: monitors.create,
    get: monitors.get,
    update: monitors.update,
    enable: monitors.enable,
    disable: monitors.disable,
    delete: monitors.remove,
  },
  billing: {
    plans: billing.plans,
    subscription: billing.subscription,
    checkout: billing.checkout,
    portal: billing.portal,
  },
  queries: {
    run: queries.run,
    schema: queries.schema,
    dimensionValues: queries.dimensionValues,
  },
  share: {
    view: share.view,
    readouts: share.readouts,
  },
} as const;

export type Contract = typeof contract;

export {
  requirementFor,
  requirements,
  permissionOf,
  schemesFor,
  securityFor,
  SECURITY_SCHEMES,
  type AuthorizationRequirement,
  type ResourceType,
  type SecurityScheme,
} from "./authorization";

export {
  API_INFO,
  API_TAGS,
  SECURITY_SCHEME_DEFINITIONS,
  type SecuritySchemeObject,
} from "./document";

export { ORPC_ERROR_CODES, STATUS_OF_CODE } from "./errors";

export * from "./schemas/analysis";
export * from "./schemas/dashboarding";
export * from "./schemas/identity";
export * from "./schemas/ingestion";
export { INGESTION_PATHS, INGESTION_SCHEMAS } from "./ingestion-document";
export * from "./schemas/project";
export * from "./schemas/readout";
export * from "./schemas/tenancy";
export * from "./primitives";

/**
 * The request and response types of every procedure, keyed the same way the
 * contract is. This is what the console and the SDKs type themselves from, so a
 * schema change is a compile error in the caller rather than a runtime surprise.
 */
export type ContractInputs = InferContractRouterInputs<Contract>;
export type ContractOutputs = InferContractRouterOutputs<Contract>;
