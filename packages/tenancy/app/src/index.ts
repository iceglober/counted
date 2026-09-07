/**
 * @counted/tenancy-app — tenancy use cases.
 *
 * **Every use case here takes repositories, not a `UnitOfWork`.** That is a
 * decision, not an omission. The two flows that matter span contexts — creating
 * a workspace also writes better-auth's organization row, and creating a
 * project also writes the Project aggregate — and neither of those packages may
 * import this one. So the transaction is opened by the composition root, which
 * is the only layer that can see both halves:
 *
 *     await uow.transact(async (r) => {
 *       const reserved = await reserveProjectSlot({ workspaces: r.workspaces }, cmd, at)
 *       if (isErr(reserved)) return reserved          // commits; nothing was written
 *       return createProject({ projects: r.projects }, cmd, at)
 *     })
 *
 * A use case that opened its own transaction would guarantee the split write it
 * exists to prevent: a slot reserved for a project whose creation then failed.
 * `TenancyRepositories` in `ports.ts` names the bundle to hand in.
 *
 * A `Result` returned from `transact` is a *successful* transaction reporting a
 * refused rule, and it commits. If a refusal must roll back, throw.
 */

export * from "./ports";
export * from "./provision-workspace";
export * from "./project-cap";
export * from "./change-plan";
export * from "./record-billing-event";
export * from "./entitlements";
