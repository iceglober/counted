/**
 * Project failures. Values in a Result, never exceptions.
 */

import type { CredentialId, ProjectId } from "../shared/ids";

export type ProjectError =
  | { kind: "NameRequired" }
  | { kind: "NameUnchanged" }
  | { kind: "FirstCredentialMustIngest" }
  | { kind: "ScopesRequired" }
  | { kind: "CredentialExists"; credential: CredentialId }
  | { kind: "UnknownCredential" }
  | { kind: "CredentialRevoked"; credential: CredentialId }
  | { kind: "CredentialExpired"; credential: CredentialId }
  | { kind: "LastIngestCredential"; credential: CredentialId }
  | { kind: "RotationKindMismatch" }
  | { kind: "AlreadyClaimed" }
  | { kind: "GrantExpired" }
  | { kind: "GrantMismatch" }
  | { kind: "NoSuchProject"; project: ProjectId };
