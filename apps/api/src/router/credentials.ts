/**
 * API keys.
 *
 * Requests may narrow a service key's permissions. The application validates
 * them against the issuer's current delegable permissions before issuing.
 *
 * `credentials.self` is the one route an ingest key can call. An agent that has
 * just provisioned a project holds a key and nothing else; this is how it
 * learns which project it holds a key for, without a browser.
 */

import { CredentialId, Duration, unbrand } from "@counted/kernel";
import { grantableTo } from "@counted/projects-domain";
import { permissionsHeldBy } from "@counted/authorization";
import {
  issueCredential,
  issueWorkspaceCredential,
  rotateWorkspaceCredential,
  revokeWorkspaceCredential,
  listCredentials,
  listWorkspaceCredentials,
  revokeCredential,
  rotateCredential,
} from "@counted/projects-app";
import { raise } from "../faults";
import * as serialize from "../serialize";
import { projectDeps } from "../wiring";
import type { HandlerDeps } from "./deps";
import { actingAccount, locatedProject, locatedWorkspace, orCredentialFault } from "./support";
import { bearerToken } from "../auth/principal";

export const credentialRoutes = ({ deps, guarded }: HandlerDeps) => ({
  list: guarded.credentials.list.handler(async ({ context }) => {
    const project = locatedProject(context.authority.located);
    const listing = await listCredentials(projectDeps(deps), project);
    // Revoked keys are included: an audit needs them. The secret is not, and
    // there is no shape in the contract that could carry it — v1's key list
    // returned the full key for every key the caller could see.
    return { items: listing.map((entry) => serialize.credential(entry.credential, context.at)) };
  }),

  issue: guarded.credentials.issue.handler(async ({ input, context }) => {
    const project = locatedProject(context.authority.located);
    const issued = orCredentialFault(
      await issueCredential(projectDeps(deps), {
        project,
        kind: input.kind,
        name: input.name,
        issuedBy: actingAccount(context.authority.principal),
        // The current role, narrowed by the calling credential's own scopes.
        held: permissionsHeldBy(context.authority.principal),
        ...(input.permissions === undefined ? {} : { requested: input.permissions }),
        expiresIn: input.expiresInMs === undefined ? null : Duration.millis(input.expiresInMs),
      }),
    );
    return { issued: serialize.issuedCredential(issued, context.at) };
  }),

  rotate: guarded.credentials.rotate.handler(async ({ input, context }) => {
    const project = locatedProject(context.authority.located);
    const rotated = orCredentialFault(
      await rotateCredential(projectDeps(deps), {
        project,
        credential: CredentialId(input.credentialId),
        held: permissionsHeldBy(context.authority.principal),
        // The caller does not say which kind it expects, so the rotation keeps
        // whatever kind the key already had. `expected` exists for a caller
        // that does care — a script rotating "the ingest key" should not
        // silently rotate a service key somebody renamed.
        expected: null,
        overlap: input.overlapMs === undefined ? null : Duration.millis(input.overlapMs),
      }),
    );
    return {
      rotated: {
        issued: serialize.issuedCredential(rotated.issued, context.at),
        retiring: serialize.credential(rotated.retiring, context.at),
      },
    };
  }),

  revoke: guarded.credentials.revoke.handler(async ({ input, context }) => {
    const project = locatedProject(context.authority.located);
    const credential = CredentialId(input.credentialId);
    orCredentialFault(await revokeCredential(projectDeps(deps), { project, credential }));
    return { revoked: true as const, credential: unbrand(credential) };
  }),

  /**
   * A key placed on the workspace rather than on one project.
   *
   * This is the route that closes the agent path. Every key `issue` above
   * mints is project-bound, and a project-bound principal is refused anything
   * placed at the workspace — including `projects.claim`, which is authorized
   * on the destination. So before this existed, a key could provision a
   * project through the no-signup path and then had no way to keep it.
   */
  issueForWorkspace: guarded.credentials.issueForWorkspace.handler(async ({ input, context }) => {
    const workspace = locatedWorkspace(context.authority.located);
    const issued = orCredentialFault(
      await issueWorkspaceCredential(projectDeps(deps), {
        workspace,
        name: input.name,
        issuedBy: actingAccount(context.authority.principal),
        held: permissionsHeldBy(context.authority.principal),
        ...(input.permissions === undefined ? {} : { requested: input.permissions }),
        expiresIn: input.expiresInMs === undefined ? null : Duration.millis(input.expiresInMs),
      }),
    );
    return { issued: serialize.issuedCredential(issued, context.at) };
  }),

  rotateForWorkspace: guarded.credentials.rotateForWorkspace.handler(async ({ input, context }) => {
    const rotated = orCredentialFault(await rotateWorkspaceCredential(projectDeps(deps), {
      workspace: locatedWorkspace(context.authority.located),
      credential: CredentialId(input.credentialId),
      held: permissionsHeldBy(context.authority.principal),
      overlap: input.overlapMs === undefined ? null : Duration.millis(input.overlapMs),
    }));
    return { rotated: {
      issued: serialize.issuedCredential(rotated.issued, context.at),
      retiring: serialize.credential(rotated.retiring, context.at),
    } };
  }),

  revokeForWorkspace: guarded.credentials.revokeForWorkspace.handler(async ({ input, context }) => {
    const credential = CredentialId(input.credentialId);
    orCredentialFault(await revokeWorkspaceCredential(projectDeps(deps), {
      workspace: locatedWorkspace(context.authority.located), credential,
    }));
    return { revoked: true as const, credential: unbrand(credential) };
  }),

  listForWorkspace: guarded.credentials.listForWorkspace.handler(async ({ context }) => {
    const workspace = locatedWorkspace(context.authority.located);
    const listing = await listWorkspaceCredentials(projectDeps(deps), workspace);
    const grantable = grantableTo("service", permissionsHeldBy(context.authority.principal));
    return { items: listing.map((entry) => serialize.credential(entry.credential, context.at)), grantablePermissions: grantable.ok ? [...grantable.value] : [] };
  }),

  /**
   * What the calling credential is.
   *
   * Verified a second time rather than reconstructed from the principal: the
   * principal carries an ingest key's *live* workspace (the project's, not the
   * key row's — see `auth/principal.ts`), and this route is describing the key,
   * so it has to read the key. The two answers differ for exactly one kind of
   * key, and that is the kind this route exists for.
   */
  self: guarded.credentials.self.handler(async ({ context }) => {
    const secret = bearerToken(context.request.headers);
    if (secret === null) {
      raise({
        code: "UNAUTHORIZED",
        message: "No usable credential was presented.",
        data: { reason: "NotAuthenticated" },
      });
    }
    const verified = await deps.identity.credentials.verify(secret, context.at);
    if (!verified.ok) {
      raise({
        code: "UNAUTHORIZED",
        message: "No usable credential was presented.",
        data: { reason: "NotAuthenticated" },
      });
    }
    return { credential: serialize.credentialIdentity(verified.value) };
  }),
});
