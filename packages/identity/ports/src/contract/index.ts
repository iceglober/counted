/**
 * `@counted/identity-ports/contract` — the executable definition of what an
 * identity adapter must do.
 *
 * Each suite takes a label and a factory that stands the world up. The
 * better-auth adapter runs them against a real instance; `.../testing` runs
 * them against the in-memory fakes. A port whose obligations live only in prose
 * is not an abstraction — it is one implementation and a hope.
 */

export * from "./result";
export * from "./account-directory.contract";
export * from "./membership-directory.contract";
export * from "./membership-writer.contract";
export * from "./credential-store.contract";
