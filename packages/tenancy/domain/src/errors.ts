/**
 * Tenancy failures. Every one is a rule someone can break, so they are values
 * returned in a `Result` — not exceptions, and not strings.
 *
 * The `kind` discriminant is what `@counted/contract` mirrors as the `reason`
 * literal inside a typed oRPC error's `data`, and what `assertNever` uses to
 * make a new variant a compile error everywhere it is handled. The
 * kind-to-code table is V3-SPEC §6.
 */

import type { AccountId, ProjectId, Role, WorkspaceId } from "@counted/kernel";

/**
 * What the tenancy context can refuse.
 *
 * Five of these — `AlreadyAMember`, `NotAMember`, `RoleUnchanged`, `LastOwner`
 * and the membership half of `SeatLimitReached` — are about membership, which
 * this context does not own. better-auth's organization plugin owns
 * `organization`, `member` and `invitation`, enforces last-owner protection
 * itself, and is written to through its own API. They are declared here because
 * they are the membership surface's vocabulary and the wire contract is built
 * from this union; tenancy produces only `SeatLimitReached`, which is an
 * entitlement question (`may this plan seat another person`) rather than a
 * membership one, and which nothing but this context can answer.
 */
export type WorkspaceError =
  | { readonly kind: "NameRequired" }
  | { readonly kind: "NoSuchWorkspace"; readonly workspace: WorkspaceId }
  | { readonly kind: "AlreadyAMember"; readonly account: AccountId }
  | { readonly kind: "NotAMember"; readonly account: AccountId }
  | { readonly kind: "RoleUnchanged"; readonly account: AccountId; readonly role: Role }
  | { readonly kind: "LastOwner"; readonly account: AccountId }
  | { readonly kind: "SeatLimitReached"; readonly limit: number }
  | { readonly kind: "ProjectExists"; readonly project: ProjectId }
  | { readonly kind: "NoSuchProject"; readonly project: ProjectId }
  | { readonly kind: "ProjectAlreadyArchived"; readonly project: ProjectId }
  | { readonly kind: "ProjectNotArchived"; readonly project: ProjectId }
  | { readonly kind: "ProjectLimitReached"; readonly limit: number };

/**
 * What the billing surface can refuse.
 *
 * Separate from `WorkspaceError` because these are failures of the conversation
 * with the payment provider, not of a workspace rule, and they map to a
 * different set of status codes — `BadSignature` is a 400 about the request,
 * `ProviderUnavailable` is a 502 about someone else.
 *
 * `BadSignature`, `Stale` and `Malformed` mirror `WebhookRejection` from
 * `@counted/tenancy-ports`. They are restated rather than imported because a
 * domain may not import a ports package; the app layer translates one into the
 * other in a single function, which is the only place the two can drift.
 */
export type BillingError =
  | { readonly kind: "NoSubscription"; readonly workspace: WorkspaceId }
  | { readonly kind: "PlanUnavailable"; readonly plan: string }
  | { readonly kind: "BadSignature" }
  | { readonly kind: "Stale"; readonly ageSeconds: number }
  | { readonly kind: "Malformed"; readonly detail: string }
  | { readonly kind: "ProviderUnavailable"; readonly detail: string };
