/**
 * Projects, and the two routes that make the no-signup path complete.
 *
 * **Creating a project is two aggregates and they are not in one transaction.**
 * The workspace agrees the project may exist (taking a slot against the plan's
 * cap) and the projects context creates it with its first ingest key — and the
 * second of those is itself a saga, because the key row is better-auth's and
 * shares no transaction with ours. So the order here is chosen for what
 * survives a failure, and every path says which state that is:
 *
 *   create   reserve the slot → provision under the id that was reserved.
 *   archive  archive the project → free the slot.
 *   restore  take the slot back (re-checks the cap) → restore the project.
 *   claim    take a slot in the destination → claim → on refusal, give it back.
 *   delete   revoke keys and delete → drop the slot.
 *
 * There is one cap check and it is `Workspace.registerProject`. An advisory
 * pre-check used to stand in front of it; it was a second reading of the same
 * rule with nothing comparing the two, and reserving first made it redundant.
 *
 * v1 enforced its project cap in exactly one of three creation paths, so
 * provisioning and claiming both walked straight past it. All five paths here
 * go through the workspace aggregate.
 */

import { Instant, ProjectId, isErr, ok, unbrand } from "@counted/kernel";
import { randomToken, sha256Base64Url } from "@counted/adapter-crypto";
import {
  ClaimDigest,
  Project,
  RETENTION_INHERIT,
  retentionPolicy,
  suggestedProjectName,
} from "@counted/projects-domain";
import {
  archiveProject,
  claimProject,
  deleteProject,
  provisionProject,
  provisionUnclaimedProject,
  renameProject,
  restoreProject,
  setProjectRetention,
} from "@counted/projects-app";
import { permissionsHeldBy } from "@counted/authorization";
import {
  dropProjectSlot,
  releaseProjectSlot,
  reserveProjectSlot,
  restoreProjectSlot,
} from "@counted/tenancy-app";
import { fromProjectError, fromWorkspaceError, raise } from "../faults";
import * as serialize from "../serialize";
import { planRetentionDays, projectDeps } from "../wiring";
import type { HandlerDeps } from "./deps";
import {
  actingAccount,
  locatedProject,
  locatedWorkspace,
  orCredentialFault,
  orProjectFault,
} from "./support";

export const projectRoutes = ({ deps, guarded }: HandlerDeps) => {
  const projects = () => projectDeps(deps);

  /** Load a project, or answer the 404 the contract declares. */
  const load = async (id: ProjectId) => {
    const found = await deps.reads.projects.find(id);
    if (found === null) raise(fromProjectError({ kind: "NoSuchProject", project: id }));
    return found;
  };

  const rendered = async (snapshot: ReturnType<Project["snapshot"]>) =>
    serialize.project(
      snapshot,
      await planRetentionDays(
        deps,
        deps.reads,
        snapshot.ownership.state === "claimed" ? snapshot.ownership.workspace : null,
      ),
    );

  return {
    list: guarded.projects.list.handler(async ({ input, context }) => {
      const workspace = locatedWorkspace(context.authority.located);
      const summaries = await deps.reads.projects.summariesForWorkspace(workspace);
      const items = input.includeArchived === true
        ? summaries
        : summaries.filter((summary) => !summary.archived);
      return { items: items.map(serialize.projectSummary) };
    }),

    /**
     * The slot is reserved BEFORE the project row exists, and the order is the
     * whole of this handler.
     *
     * `Workspace`'s project register is derived — `PostgresWorkspaceRepository`
     * builds it with a `SELECT` over the `projects` table rather than storing
     * a second copy. So a slot reserved *after* the row is written finds the
     * project already registered and refuses every creation with
     * `ProjectExists`; the compensating delete then removes it, and creating a
     * project fails 100% of the time. Only a real database shows this: an
     * in-memory workspace fake keeps its own register and the two orders look
     * identical.
     *
     * Reserving first also makes the cap true rather than advisory.
     * `find` takes `SELECT … FOR UPDATE` inside a transaction, so two
     * concurrent creations queue, and the second one counts the first.
     *
     * Nothing needs undoing when provisioning then fails: the register is
     * derived, so an unwritten project holds no slot. This is the same order
     * `claim` below already uses.
     */
    create: guarded.projects.create.handler(async ({ input, context }) => {
      const workspace = locatedWorkspace(context.authority.located);
      const issuedBy = actingAccount(context.authority.principal);

      // Minted here rather than inside `provisionProject`, because the
      // reservation names the project and the two must be the same id.
      const id = ProjectId(deps.ids.next());
      // Resolved here for the same reason: the reservation carries the name,
      // and `provisionProject` substitutes a generated one for a blank.
      const name = input.name.trim().length === 0 ? suggestedProjectName() : input.name;

      const reserved = await deps.uow.transact((repositories) =>
        reserveProjectSlot(
          { workspaces: repositories.workspaces },
          { workspace, project: id, name },
          context.at,
        ),
      );
      if (isErr(reserved)) raise(fromWorkspaceError(reserved.error));

      const provisioned = orCredentialFault(
        await provisionProject(projects(), {
          workspace,
          name,
          issuedBy,
          held: permissionsHeldBy(context.authority.principal),
          id,
        }),
      );

      return { project: await rendered(provisioned.project) };
    }),

    get: guarded.projects.get.handler(async ({ context }) => {
      const id = locatedProject(context.authority.located);
      return { project: await rendered((await load(id)).snapshot()) };
    }),

    rename: guarded.projects.rename.handler(async ({ input, context }) => {
      const id = locatedProject(context.authority.located);
      const snapshot = orProjectFault(
        await renameProject(projects(), { project: id, name: input.name }),
      );
      return { project: await rendered(snapshot) };
    }),

    archive: guarded.projects.archive.handler(async ({ context }) => {
      const id = locatedProject(context.authority.located);
      const snapshot = orProjectFault(await archiveProject(projects(), { project: id }));

      // The slot is freed after the project is archived. The other order would
      // free a slot for a project that then failed to archive — a customer
      // could create a replacement and end up over the cap.
      const workspace = snapshot.ownership.state === "claimed" ? snapshot.ownership.workspace : null;
      if (workspace !== null) {
        const released = await deps.uow.transact((repositories) =>
          releaseProjectSlot(
            { workspaces: repositories.workspaces },
            { workspace, project: id },
            context.at,
          ),
        );
        // Two answers from the register are not failures. `NoSuchProject`: it
        // never held this project — an older row, or a create that
        // half-failed. `ProjectAlreadyArchived`: the register is loaded from
        // the `projects` table, which the line above has just marked archived,
        // so the workspace already counts the slot as free; there is nothing
        // left to release. Either way archiving succeeded, and failing the
        // request would leave the caller with an archived project and a 409.
        if (
          isErr(released) &&
          released.error.kind !== "NoSuchProject" &&
          released.error.kind !== "ProjectAlreadyArchived"
        ) {
          raise(fromWorkspaceError(released.error));
        }
      }

      return { project: await rendered(snapshot) };
    }),

    restore: guarded.projects.restore.handler(async ({ context }) => {
      const id = locatedProject(context.authority.located);
      const project = await load(id);
      const workspace = project.workspace;

      // The slot is taken back FIRST, because taking it re-checks the cap. The
      // other order makes archive-then-restore a way past the plan's limit,
      // which is the same rule enforced in one direction only.
      if (workspace !== null) {
        const restored = await deps.uow.transact((repositories) =>
          restoreProjectSlot(
            { workspaces: repositories.workspaces },
            { workspace, project: id },
            context.at,
          ),
        );
        if (isErr(restored)) raise(fromWorkspaceError(restored.error));
      }

      const snapshot = orProjectFault(await restoreProject(projects(), { project: id }));
      return { project: await rendered(snapshot) };
    }),

    setRetention: guarded.projects.setRetention.handler(async ({ input, context }) => {
      const id = locatedProject(context.authority.located);
      const policy =
        input.retention.kind === "inherit"
          ? ok(RETENTION_INHERIT)
          : retentionPolicy(input.retention.days);
      const snapshot = orProjectFault(
        await setProjectRetention(projects(), {
          project: id,
          retention: orProjectFault(policy),
        }),
      );
      return { project: await rendered(snapshot) };
    }),

    delete: guarded.projects.delete.handler(async ({ context }) => {
      const id = locatedProject(context.authority.located);
      const project = await load(id);
      const workspace = project.workspace;

      // Keys are revoked and the project deleted first. If the slot drop then
      // fails, what survives is a slot held by a project that no longer exists
      // — visible in the usage readout and fixable. The other order leaves live
      // keys pointing at a project with no console page to revoke them from.
      orProjectFault(await deleteProject(projects(), { project: id }));

      if (workspace !== null) {
        const dropped = await deps.uow.transact((repositories) =>
          dropProjectSlot(
            { workspaces: repositories.workspaces },
            { workspace, project: id },
            context.at,
          ),
        );
        if (isErr(dropped) && dropped.error.kind !== "NoSuchProject") {
          raise(fromWorkspaceError(dropped.error));
        }
      }

      return { deleted: true as const, project: unbrand(id) };
    }),

    /**
     * Provision an unclaimed project: no credential in, a working ingest key
     * out.
     *
     * The ingest key is issued against the configured holding workspace,
     * because `IssueRequest.workspace` is not nullable and an unclaimed project
     * has none. That does not widen the key: an ingest principal's binding is
     * built from the project's *current* workspace, not the key's recorded one
     * (`auth/principal.ts`), so the key reaches one project and keeps working
     * after the project is claimed.
     *
     * The saga itself is `provisionUnclaimedProject` and not written out here.
     * It was, and the difference was not cosmetic: the inline version reported
     * a failed *issuance* as `NoSuchProject`, so the one thing this route
     * exists to do failed while blaming the project it had just created.
     */
    provision: guarded.projects.provision.handler(async ({ input, context }) => {
      const at = context.at;
      const token = randomToken(32);
      const expiresAt = Instant.plus(at, deps.config.claimGrantTtl);

      // The token is minted here and hashed here — randomness is an adapter's
      // by rule, and the use case never sees the plaintext, which is what
      // makes "shown once" a property of the code rather than a promise.
      const provisioned = orCredentialFault(
        await provisionUnclaimedProject(projects(), {
          name: input.name ?? "",
          grant: { digest: ClaimDigest(sha256Base64Url(token)), expiresAt },
          holding: {
            workspace: deps.config.unclaimedWorkspace,
            issuedBy: deps.config.unclaimedWorkspaceOwner,
          },
        }),
      );

      return {
        project: await rendered(provisioned.project),
        credential: serialize.issuedCredential(provisioned.credential, at),
        claim: { token, expiresAt: Instant.toISO(expiresAt) },
      };
    }),

    /**
     * Adopt a provisioned project into a workspace.
     *
     * Authorized on the destination — the grant proves the caller provisioned
     * the project, `projects:write` proves they may put a project in that
     * workspace. Reachable with a service key, which is what closes the agent
     * path: in v2 claiming needed a console session, so an agent could
     * provision a project and then had no way to keep it.
     */
    claim: guarded.projects.claim.handler(async ({ input, context }) => {
      const workspace = locatedWorkspace(context.authority.located);
      const id = ProjectId(input.projectId);
      const project = await load(id);

      // The slot is taken before the claim, because taking it is what enforces
      // the destination's cap. Claiming first would let a full workspace adopt
      // an unlimited number of projects, which is the v1 hole exactly.
      const reserved = await deps.uow.transact((repositories) =>
        reserveProjectSlot(
          { workspaces: repositories.workspaces },
          { workspace, project: id, name: project.name },
          context.at,
        ),
      );
      if (isErr(reserved)) raise(fromWorkspaceError(reserved.error));

      const claimed = await claimProject(projects(), {
        project: id,
        digest: sha256Base64Url(input.claimToken),
        into: workspace,
      });

      if (isErr(claimed)) {
        // Give the slot back. A refused claim that kept the slot would let a
        // wrong token consume a workspace's capacity, one attempt at a time.
        await deps.uow.transact((repositories) =>
          dropProjectSlot(
            { workspaces: repositories.workspaces },
            { workspace, project: id },
            context.at,
          ),
        );
        raise(fromProjectError(claimed.error));
      }

      return { project: await rendered(claimed.value) };
    }),
  };
};
