/**
 * Facts emitted by the Project aggregate. Past tense, consumed via the outbox.
 *
 * CredentialRotated carries graceEndsAt so an operator can see exactly when
 * the outgoing key stops working — v1 gave no such window at all.
 */

import type { CredentialId, ProjectId, WorkspaceId } from "../shared/ids";
import type { Instant } from "../shared/instant";
import type { CredentialKind } from "./credential";

export type ProjectEvent =
  | { kind: "ProjectCreated"; project: ProjectId; workspace: WorkspaceId; name: string; at: Instant }
  | { kind: "ProjectProvisionedUnclaimed"; project: ProjectId; name: string; at: Instant }
  | { kind: "ProjectClaimed"; project: ProjectId; workspace: WorkspaceId; at: Instant }
  | { kind: "ProjectRenamed"; project: ProjectId; name: string; at: Instant }
  | { kind: "CredentialIssued"; project: ProjectId; credential: CredentialId; credentialKind: CredentialKind; at: Instant }
  | { kind: "CredentialRotated"; project: ProjectId; outgoing: CredentialId; replacement: CredentialId; graceEndsAt: Instant; at: Instant }
  | { kind: "CredentialRevoked"; project: ProjectId; credential: CredentialId; at: Instant };
