/**
 * `@counted/agent` — the generic hook binary, plus the pieces it is built from
 * so a host with an unusual integration point can assemble its own.
 */

export { handle, main, parseHost, readKey, readEndpoint, isAgentHost, DEFAULT_ENDPOINT, SELF_KILL_MS, type RunDeps } from "./run";
export { HOSTS, openCodeProjection, type Action, type HostEvent, type Reading } from "./hosts";
export { projectionFor, resolveSetup, type CachedSetup } from "./setup";
