/**
 * @counted/mcp-server — MCP tools projected from the contract.
 *
 * Not a parallel surface: each contract procedure this server exposes becomes a
 * tool whose description and argument schema *are* the contract's, by
 * reference, and whose call goes to the same HTTP route the console calls,
 * carrying the caller's own token. **An agent gets exactly the permissions its
 * token carries — there is no MCP-specific authorization path.** Nothing in
 * this package reads a permission, a role or a scope; `packages/authorization`
 * inside `apps/api` answers that question once, for MCP and HTTP alike.
 *
 * Authentication is the MCP 2026-07-28 profile: RFC 9728 protected-resource
 * metadata, a `401` with a `WWW-Authenticate` challenge that starts the OAuth
 * flow, and resource-bound access tokens minted by better-auth's MCP plugin
 * inside `apps/api`. Whether a token is live is asked of the API rather than
 * decided here, so there is one thing in the system that knows.
 */

/**
 * This module is the library surface. The process — environment, port, signals
 * — is `main.ts`, which is what the image and `bun run start` run.
 */

export { readConfig, describeConfigFailure, type Config, type ConfigFailure } from "./config";
export {
  apiVerifier,
  bearerOf,
  challengeFor,
  metadataPathFor,
  metadataUrlFor,
  protectedResourceMetadata,
  type ResourceIdentity,
  type TokenVerifier,
  type Verdict,
} from "./authentication";
export { createHandler, HEALTH_PATH, READY_PATH, type HandlerOptions } from "./handler";
export {
  buildRequest,
  httpInvoker,
  type ContractInvoker,
  type Invocation,
  type InvocationOutcome,
} from "./invoke";
export { project, toolNameOf, TOOLS, TOOLS_BY_NAME, type Tool } from "./projection";
export { EXPOSED, WITHHELD, type Exposure } from "./exposure";
export { buildServer, SERVER_NAME, SERVER_VERSION, INSTRUCTIONS } from "./server";
