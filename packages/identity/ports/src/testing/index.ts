/**
 * `@counted/identity-ports/testing` — in-memory identity, for every other
 * package's tests.
 *
 * Deliberately a separate entry point from the package root: nothing in
 * production should be able to reach an `inMemory*` by importing
 * `@counted/identity-ports`.
 *
 * Every fake here passes the matching suite in `@counted/identity-ports/contract`,
 * which is the only reason to believe it stands in for the real thing.
 */

export * from "./ids";
export * from "./role-grants";
export * from "./in-memory-account-directory";
export * from "./in-memory-membership-directory";
export * from "./in-memory-credential-store";
