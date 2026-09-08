/**
 * `@counted/tenancy-app/contract` — the executable definition of what a
 * tenancy adapter must do.
 *
 * Each suite takes a label and a factory that stands the world up.
 * `@counted/adapter-postgres` runs the three storage ones against a real
 * database, `@counted/adapter-stripe` runs the gateway one against a real
 * signature scheme, and `../contract.test.ts` runs all four against the
 * in-memory doubles in `../testing.ts`. A port whose obligations live only in
 * prose is not an abstraction — it is one implementation and a hope.
 *
 * **Why these live here and not in `@counted/tenancy-ports`.** The identity
 * suites live in that context's ports package because its ports are concrete.
 * The tenancy ones are generic in the aggregate — `WorkspaceRepository<Workspace,
 * WorkspaceEvent>` — so that a storage contract does not have to import the
 * thing it stores, and `../ports.ts` is the single file that closes those
 * parameters. A contract suite in the ports package would have to re-close
 * them, which is the mismatch `../ports.ts` exists to prevent. So the suites
 * sit beside the closure, and beside the doubles they are written against.
 */

export * from "./result";
export * from "./workspace-repository.contract";
export * from "./subscription-repository.contract";
export * from "./webhook-ledger.contract";
export * from "./billing-gateway.contract";
