/**
 * Project failures. Values in a `Result`, never exceptions.
 *
 * The mapping from each `kind` to an oRPC error code lives in V3-SPEC §6 and
 * nowhere else — a domain that named its own HTTP status would be a domain that
 * knows about HTTP.
 */

import type { CredentialId, Permission, ProjectId } from "@counted/kernel";

export type ProjectError =
  | { readonly kind: "NameRequired" }
  | { readonly kind: "NameUnchanged" }
  | { readonly kind: "NoSuchProject"; readonly project: ProjectId }
  /**
   * A project's first credential must be an ingest key. v1's signup path
   * created projects with no usable ingest key at all, so the first thing a new
   * user did — paste the snippet — silently dropped every event.
   */
  | { readonly kind: "FirstCredentialMustIngest" }
  | { readonly kind: "PermissionsRequired" }
  /**
   * Q3, the grant-subset rule. `requested` is the excess — the permissions the
   * issuer does not hold — not the whole request, because the excess is the
   * part a human has to act on.
   */
  | {
      readonly kind: "PermissionEscalation";
      readonly requested: readonly Permission[];
      readonly held: readonly Permission[];
    }
  | { readonly kind: "CredentialExists"; readonly credential: CredentialId }
  | { readonly kind: "UnknownCredential"; readonly credential: CredentialId }
  | { readonly kind: "CredentialRevoked"; readonly credential: CredentialId }
  | { readonly kind: "CredentialExpired"; readonly credential: CredentialId }
  | { readonly kind: "LastIngestCredential"; readonly credential: CredentialId }
  | { readonly kind: "RotationKindMismatch" }
  | { readonly kind: "AlreadyClaimed" }
  | { readonly kind: "GrantExpired" }
  | { readonly kind: "GrantMismatch" }
  // ---- added in this package; see the hand-off note ------------------------
  /**
   * Used for both "you cannot archive this twice" and "you cannot do that to an
   * archived project". One kind rather than two, because from the caller's side
   * they are the same fact: the project is archived and the write is refused.
   */
  | { readonly kind: "ProjectArchived"; readonly project: ProjectId }
  | { readonly kind: "ProjectNotArchived"; readonly project: ProjectId }
  | { readonly kind: "InvalidRetention"; readonly days: number }
  | { readonly kind: "RetentionUnchanged" };
