/**
 * Facts the Project aggregate emits. Past tense, dispatched through the outbox.
 *
 * `CredentialRotated` carries `graceEndsAt` so an operator can read, from the
 * event alone, the instant the outgoing secret stops working. v1 had no such
 * window: rotation overwrote the key in place, every deployed client broke on
 * the click, and there was nothing in the record to say when.
 */

import type { CredentialId, Instant, ProjectId, WorkspaceId } from "@counted/kernel";
import type { CredentialKind } from "./credential";

/**
 * Credential events are Project events even though better-auth owns the rows.
 * The row is storage; "a key was issued on this project" is a fact about the
 * project, and it is the project's outbox that has to carry it.
 */
export type ProjectEvent =
  | {
      readonly kind: "ProjectCreated";
      readonly project: ProjectId;
      readonly workspace: WorkspaceId;
      readonly name: string;
      readonly at: Instant;
    }
  | {
      readonly kind: "ProjectProvisionedUnclaimed";
      readonly project: ProjectId;
      readonly name: string;
      readonly grantExpiresAt: Instant;
      readonly at: Instant;
    }
  | {
      readonly kind: "ProjectClaimed";
      readonly project: ProjectId;
      readonly workspace: WorkspaceId;
      readonly at: Instant;
    }
  | {
      readonly kind: "ProjectRenamed";
      readonly project: ProjectId;
      readonly name: string;
      readonly at: Instant;
    }
  | { readonly kind: "ProjectArchived"; readonly project: ProjectId; readonly at: Instant }
  | { readonly kind: "ProjectRestored"; readonly project: ProjectId; readonly at: Instant }
  /**
   * Emitted by a delete, and also by the compensating delete that runs when a
   * freshly created project could not be given an ingest key. A consumer that
   * acted on `ProjectCreated` needs this to undo it — the two stores have no
   * shared transaction, so the undo has to be a fact rather than a rollback.
   */
  | {
      readonly kind: "ProjectDeleted";
      readonly project: ProjectId;
      readonly workspace: WorkspaceId | null;
      readonly at: Instant;
    }
  | {
      readonly kind: "ProjectRetentionChanged";
      readonly project: ProjectId;
      /** Null means "whatever the plan grants" — see `RetentionPolicy`. */
      readonly days: number | null;
      readonly at: Instant;
    }
  | {
      readonly kind: "CredentialIssued";
      readonly project: ProjectId;
      readonly credential: CredentialId;
      readonly credentialKind: CredentialKind;
      readonly at: Instant;
    }
  /**
   * A key placed on the workspace rather than on a project.
   *
   * A separate fact rather than a nullable `project` on `CredentialIssued`,
   * because the two are not the same event: one narrows a key to a project and
   * one deliberately does not, and a consumer filtering on "keys for project
   * X" should not have to know that a null means "all of them".
   */
  | {
      readonly kind: "WorkspaceCredentialIssued";
      readonly workspace: WorkspaceId;
      readonly credential: CredentialId;
      readonly credentialKind: CredentialKind;
      readonly at: Instant;
    }
  | {
      readonly kind: "CredentialRotated";
      readonly project: ProjectId;
      readonly outgoing: CredentialId;
      readonly replacement: CredentialId;
      readonly graceEndsAt: Instant;
      readonly at: Instant;
    }
  | {
      readonly kind: "CredentialRevoked";
      readonly project: ProjectId;
      readonly credential: CredentialId;
      readonly at: Instant;
    };
