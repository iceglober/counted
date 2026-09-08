/**
 * @counted/identity-ports — the seam between the domain and better-auth.
 *
 * Every type here is expressed in kernel vocabulary. Nothing in this package
 * mentions better-auth, and the `only-the-identity-adapter-knows-better-auth`
 * rule in .dependency-cruiser.cjs keeps it that way — if these interfaces ever
 * start describing better-auth's shapes instead of ours, the adapter has
 * stopped being an adapter.
 *
 * Two subpaths sit beside this one, deliberately not re-exported here so that
 * production code cannot reach them by accident:
 *
 *   `@counted/identity-ports/contract` — the executable definition of what an
 *       implementation must do. The better-auth adapter runs these; so does
 *       anything that ever replaces it. A port whose obligations live only in
 *       prose is not swappable, it is just untested.
 *   `@counted/identity-ports/testing` — in-memory implementations that pass
 *       those suites, for every other package's tests.
 */

export * from "./account-directory";
export * from "./membership-directory";
export * from "./membership-writer";
export * from "./organization-directory";
export * from "./credential-kind";
export * from "./credential-store";
