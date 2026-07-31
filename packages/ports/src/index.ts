/**
 * @counted/ports — the interfaces the domain talks through, and the contract
 * suites every adapter must pass.
 *
 * A port lives here; an implementation never does. The dependency rule is
 * enforced in CI: this package may reference @counted/domain and nothing else.
 */

export * from "./driven/access";
export * from "./driven/console";
export * from "./driven/billing";
export * from "./driven/jobs";
export * from "./driven/analytical-store";
export * from "./driven/event-writer";
export * from "./driven/repositories";
export * from "./driven/services";
export * from "./driven/types";
export * from "./driven/unit-of-work";
export * from "./driving/use-cases";
